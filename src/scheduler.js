const cron = require('node-cron');
const { scheduledDb, groupsDb, messagesDb } = require('./database');
const { sendToGroups, getState } = require('./whatsapp');

let io = null;

function setIO(socketIO) {
  io = socketIO;
}

function emit(event, data) {
  if (io) io.emit(event, data);
}

function startScheduler() {
  // Check every minute for pending scheduled messages
  cron.schedule('* * * * *', async () => {
    try {
      const pending = scheduledDb.getPending();
      if (pending.length === 0) return;

      console.log(`⏰ Scheduler: Found ${pending.length} message(s) to send`);

      for (const scheduled of pending) {
        // Mark as processing immediately to avoid duplicate sends
        scheduledDb.updateStatus(scheduled.id, 'processing');

        try {
          const waState = getState();
          if (!waState.connected) {
            console.log('⚠️ WhatsApp not connected — skipping scheduled message');
            scheduledDb.updateStatus(scheduled.id, 'pending');
            continue;
          }

          const targetGroupIds = JSON.parse(scheduled.target_groups);
          let groups;

          if (targetGroupIds.includes('all')) {
            groups = groupsDb.getActive();
          } else {
            groups = targetGroupIds.map(id => groupsDb.getById(id)).filter(Boolean);
          }

          if (groups.length === 0) {
            scheduledDb.updateStatus(scheduled.id, 'failed');
            continue;
          }

          emit('scheduled-sending-start', {
            id: scheduled.id,
            total: groups.length,
            content: scheduled.content.substring(0, 50)
          });

          const results = await sendToGroups(
            groups,
            scheduled.content,
            scheduled.media_path,
            scheduled.media_type,
            (current, total, group, status) => {
              emit('send-progress', { current, total, group: group.name, status });
            }
          );

          // Save to history
          messagesDb.create({
            content: scheduled.content,
            media_path: scheduled.media_path,
            media_type: scheduled.media_type,
            target_groups: groups.map(g => g.id),
            status: 'completed'
          });

          // Handle recurring
          if (scheduled.is_recurring && scheduled.recurring_type) {
            const nextTime = getNextRecurringTime(scheduled.schedule_time, scheduled.recurring_type);
            scheduledDb.create({
              ...scheduled,
              target_groups: JSON.parse(scheduled.target_groups),
              schedule_time: nextTime
            });
          }

          scheduledDb.updateStatus(scheduled.id, 'sent');

          emit('scheduled-sending-done', {
            id: scheduled.id,
            sent: results.sent.length,
            failed: results.failed.length
          });

          console.log(`✅ Scheduled message sent — ${results.sent.length} success, ${results.failed.length} failed`);

        } catch (err) {
          console.error('Scheduled send error:', err.message);
          scheduledDb.updateStatus(scheduled.id, 'failed');
          emit('scheduled-sending-error', { id: scheduled.id, error: err.message });
        }
      }
    } catch (err) {
      console.error('Scheduler error:', err.message);
    }
  });

  console.log('⏰ Scheduler started — checking every minute');
}

function getNextRecurringTime(lastTime, type) {
  const date = new Date(lastTime);
  switch (type) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    default:
      date.setDate(date.getDate() + 1);
  }
  return date.toISOString().slice(0, 16);
}

module.exports = { startScheduler, setIO };
