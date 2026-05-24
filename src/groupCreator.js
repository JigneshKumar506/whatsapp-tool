// Group Creator — processes CSVs and creates WhatsApp groups automatically
const fs = require('fs');
const path = require('path');
const { createGroup, addParticipantsToGroup, getState: getWAState } = require('./whatsapp');
const { groupsDb, contactsDb } = require('./database');

// Parse CSV file → return array of {name, phone}
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const contacts = [];

  for (let i = 1; i < lines.length; i++) { // skip header
    const parts = lines[i].split(',');
    if (parts.length >= 2) {
      const name = parts[0].trim().replace(/\r/g, '');
      const phone = parts[1].trim().replace(/\r/g, '').replace(/[^0-9]/g, '');
      if (name && phone && phone.length >= 10) {
        contacts.push({ name, phone });
      }
    }
  }
  return contacts;
}

// Extract state name from filename
function getStateFromFilename(filename) {
  return filename.replace('.csv', '').replace(/_/g, ' ');
}

// Main function — create all groups from CSV files
async function createGroupsFromCSVs(csvFiles, io) {
  const waState = getWAState();
  if (!waState.connected) throw new Error('WhatsApp not connected. Scan QR first!');

  const results = [];
  const emit = (event, data) => { if (io) io.emit(event, data); };

  emit('group-creation-start', { total: csvFiles.length });

  for (let i = 0; i < csvFiles.length; i++) {
    const file = csvFiles[i];
    const stateName = getStateFromFilename(file.originalname || path.basename(file.path));
    const contacts = parseCSV(file.path);

    emit('group-creation-progress', {
      current: i + 1,
      total: csvFiles.length,
      state: stateName,
      contacts: contacts.length,
      status: 'creating'
    });

    console.log(`\n📍 Processing: ${stateName} (${contacts.length} contacts)`);

    try {
      // Create WhatsApp group
      // WhatsApp requires at least 1 participant to create group
      // Use first valid contact as initial participant
      const firstPhone = contacts[0]?.phone;
      if (!firstPhone) {
        results.push({ state: stateName, success: false, error: 'No valid contacts' });
        continue;
      }

      const groupResult = await createGroup(stateName, [firstPhone]);
      console.log(`✅ Group created: ${stateName} — ID: ${groupResult.groupId}`);

      // Save group to database
      const dbResult = groupsDb.create({
        name: stateName,
        state: stateName,
        whatsapp_id: groupResult.groupId,
        member_count: contacts.length,
        tag: 'state'
      });
      const groupDbId = dbResult.lastInsertRowid;

      // Save all contacts to database
      contacts.forEach(c => {
        contactsDb.create({
          name: c.name,
          phone: c.phone,
          state: stateName,
          group_id: groupDbId
        });
      });

      // Add remaining contacts to group in batches
      const remaining = contacts.slice(1).map(c => c.phone);
      const BATCH_SIZE = 20;

      for (let b = 0; b < remaining.length; b += BATCH_SIZE) {
        const batch = remaining.slice(b, b + BATCH_SIZE);
        try {
          await addParticipantsToGroup(groupResult.groupId, batch);
          console.log(`  Added batch ${Math.floor(b/BATCH_SIZE)+1}: ${batch.length} contacts`);
          emit('group-creation-adding', {
            state: stateName,
            added: Math.min(b + BATCH_SIZE, remaining.length),
            total: remaining.length
          });
        } catch (err) {
          console.log(`  Batch error (normal): ${err.message}`);
        }
        // Delay between batches
        await new Promise(r => setTimeout(r, 3000));
      }

      results.push({
        state: stateName,
        success: true,
        groupId: groupResult.groupId,
        contacts: contacts.length
      });

      emit('group-creation-progress', {
        current: i + 1,
        total: csvFiles.length,
        state: stateName,
        contacts: contacts.length,
        status: 'done'
      });

      // Delay between group creations (safety)
      if (i < csvFiles.length - 1) {
        await new Promise(r => setTimeout(r, 5000));
      }

    } catch (err) {
      console.error(`❌ Failed: ${stateName} — ${err.message}`);
      results.push({ state: stateName, success: false, error: err.message });
      emit('group-creation-progress', {
        current: i + 1,
        total: csvFiles.length,
        state: stateName,
        status: 'failed',
        error: err.message
      });
    }
  }

  emit('group-creation-done', { results });
  return results;
}

module.exports = { createGroupsFromCSVs, parseCSV, getStateFromFilename };
