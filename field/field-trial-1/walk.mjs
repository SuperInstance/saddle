/**
 * walk.mjs — pure extraction functions for companion module walking.
 * These are kept separate so they can be tested against fake module objects.
 */

export function extractLines(banterMod, tierUpMod, observationsMod, rivetAmbientMod, personasMod, partMod) {
  const seen = new Map();
  const lines = [];
  let nextId = 1;

  const idFor = (text) => {
    if (seen.has(text)) return null;
    const id = `L${String(nextId).padStart(4, '0')}`;
    seen.set(text, id);
    nextId++;
    return id;
  };

  const add = (record) => {
    const id = idFor(record.text);
    if (id) lines.push({ id, ...record });
  };

  // BANTER per pool key
  if (banterMod && typeof banterMod === 'object') {
    for (const [pool, entries] of Object.entries(banterMod)) {
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (typeof entry === 'string') {
            add({ persona: 'rivet', bank: `banter.${pool}`, text: entry });
          } else if (entry && typeof entry === 'object' && 'line' in entry) {
            add({
              persona: 'rivet',
              bank: `banter.${pool}`,
              text: entry.line,
              ...(entry.tier !== undefined ? { tier: entry.tier } : {}),
              ...(entry.trait !== undefined ? { trait: entry.trait } : {}),
            });
          }
        }
      }
    }
  }

  // TIER_UP_LINES
  if (tierUpMod && typeof tierUpMod === 'object') {
    for (const [key, entries] of Object.entries(tierUpMod)) {
      if (Array.isArray(entries)) {
        const tier = key === 'coworker' ? 1 : key === 'friend' ? 2 : 1;
        for (const entry of entries) {
          if (typeof entry === 'string') {
            add({ persona: 'rivet', bank: `tierUp.${key}`, tier, text: entry });
          }
        }
      }
    }
  }

  // OBSERVATIONS
  if (Array.isArray(observationsMod)) {
    const mockStates = [
      { counters: { crashes: 0, blocksMined: 0, laps: 0, conversations: 0 }, biomes: [] },
      { counters: { crashes: 3, blocksMined: 50, laps: 5, conversations: 10 }, biomes: ['Gear Fields', 'Furnace Flats'] },
    ];
    const ctx = { tod: 'Night' };
    const observedTexts = new Set();

    for (const fn of observationsMod) {
      if (typeof fn === 'function') {
        for (const state of mockStates) {
          try {
            let result;
            if (fn.length === 1) {
              result = fn(state);
            } else {
              result = fn(state, undefined, ctx);
            }
            if (typeof result === 'string' && result.trim()) {
              observedTexts.add(result);
            }
          } catch (err) {
            // silently skip
          }
        }
      }
    }

    for (const text of observedTexts) {
      add({ persona: 'rivet', bank: 'observation', text, evaluatedWith: 'mock-state' });
    }
  }

  // RIVET_AMBIENT
  if (Array.isArray(rivetAmbientMod)) {
    for (const entry of rivetAmbientMod) {
      if (entry && typeof entry === 'object' && 'line' in entry) {
        add({
          persona: 'rivet',
          bank: 'ambient',
          text: entry.line,
          ...(entry.when ? { gate: entry.when.toString().trim() } : {}),
        });
      }
    }
  }

  // PERSONAS
  if (personasMod && typeof personasMod === 'object') {
    for (const [personaId, persona] of Object.entries(personasMod)) {
      if (!persona || typeof persona !== 'object') continue;

      // persona.banter
      if (persona.banter && typeof persona.banter === 'object') {
        for (const [pool, entries] of Object.entries(persona.banter)) {
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              if (typeof entry === 'string') {
                add({ persona: personaId, bank: `persona.${personaId}.banter.${pool}`, text: entry });
              } else if (entry && typeof entry === 'object' && 'line' in entry) {
                add({
                  persona: personaId,
                  bank: `persona.${personaId}.banter.${pool}`,
                  text: entry.line,
                  ...(entry.tier !== undefined ? { tier: entry.tier } : {}),
                  ...(entry.trait !== undefined ? { trait: entry.trait } : {}),
                });
              }
            }
          }
        }
      }

      // persona.tierUpLines
      if (persona.tierUpLines && typeof persona.tierUpLines === 'object') {
        for (const [key, entries] of Object.entries(persona.tierUpLines)) {
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              if (typeof entry === 'string') {
                add({ persona: personaId, bank: `persona.${personaId}.tierUp.${key}`, text: entry });
              }
            }
          }
        }
      }

      // persona.ambient
      if (persona.ambient && Array.isArray(persona.ambient)) {
        for (const entry of persona.ambient) {
          if (entry && typeof entry === 'object' && 'line' in entry) {
            add({ persona: personaId, bank: `persona.${personaId}.ambient`, text: entry.line });
          }
        }
      }

      // persona.observations
      if (persona.observations && Array.isArray(persona.observations)) {
        const mockStates = [
          { counters: { crashes: 0, blocksMined: 0, laps: 0, conversations: 0 }, biomes: [] },
          { counters: { crashes: 3, blocksMined: 50, laps: 5, conversations: 10 }, biomes: ['Gear Fields', 'Furnace Flats'] },
        ];
        const ctx = { tod: 'Night' };
        const observedTexts = new Set();

        for (const fn of persona.observations) {
          if (typeof fn === 'function') {
            for (const state of mockStates) {
              try {
                let result;
                if (fn.length === 1) {
                  result = fn(state);
                } else {
                  result = fn(state, undefined, ctx);
                }
                if (typeof result === 'string' && result.trim()) {
                  observedTexts.add(result);
                }
              } catch (err) {
                // silently skip
              }
            }
          }
        }

        for (const text of observedTexts) {
          add({ persona: personaId, bank: `persona.${personaId}.observation`, text, evaluatedWith: 'mock-state' });
        }
      }

      // persona.canned
      if (persona.canned && Array.isArray(persona.canned)) {
        for (const entry of persona.canned) {
          if (typeof entry === 'string') {
            add({ persona: personaId, bank: `persona.${personaId}.canned`, text: entry });
          } else if (entry && typeof entry === 'object' && 'line' in entry) {
            add({ persona: personaId, bank: `persona.${personaId}.canned`, text: entry.line });
          }
        }
      }

      // persona.roundness — recursive walk
      if (persona.roundness && typeof persona.roundness === 'object') {
        const walkRoundness = (obj, prefix) => {
          if (!obj || typeof obj !== 'object') return;
          if (typeof obj.line === 'string') {
            add({
              persona: personaId,
              bank: `persona.${personaId}.roundness.${prefix}`,
              text: obj.line,
              ...(obj.tier !== undefined ? { tier: obj.tier } : {}),
              ...(obj.trait !== undefined ? { trait: obj.trait } : {}),
            });
          }
          for (const [key, val] of Object.entries(obj)) {
            if (key !== 'line' && val && typeof val === 'object') {
              walkRoundness(val, prefix ? `${prefix}.${key}` : key);
            }
          }
        };
        walkRoundness(persona.roundness, '');
      }
    }
  }

  // CROSSTALK / OBJECTIONS from party.js
  if (partMod && typeof partMod === 'object') {
    if (partMod.crosstalk && typeof partMod.crosstalk === 'object') {
      for (const [personaId, entries] of Object.entries(partMod.crosstalk)) {
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (entry && typeof entry === 'object' && 'line' in entry) {
              add({
                persona: personaId,
                bank: `party.crosstalk.${personaId}`,
                text: entry.line,
                ...(entry.on ? { gate: entry.on } : {}),
              });
            }
          }
        }
      }
    }

    if (partMod.objections && typeof partMod.objections === 'object') {
      for (const [personaId, entries] of Object.entries(partMod.objections)) {
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (entry && typeof entry === 'object' && 'line' in entry) {
              add({
                persona: personaId,
                bank: `party.objections.${personaId}`,
                text: entry.line,
                ...(entry.on ? { gate: entry.on } : {}),
              });
            }
          }
        }
      }
    }
  }

  return lines;
}
