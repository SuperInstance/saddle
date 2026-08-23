/**
 * walk.ts — pure extraction functions for companion module walking.
 * These are kept separate so they can be tested against fake module objects.
 */

export interface ExtractedLine {
  id: string;
  persona: string;
  bank: string;
  text: string;
  tier?: number;
  trait?: string;
  gate?: string;
  evaluatedWith?: string;
}

export interface BanterEntryObj {
  line: string;
  tier?: number;
  trait?: string;
}
export type BanterEntry = string | BanterEntryObj;
export type BanterModule = Record<string, BanterEntry[]>;

export type TierUpModule = Record<string, string[]>;

export type ObservationFn = (state: any, player?: any, ctx?: any) => string | null | undefined;

export interface AmbientEntry {
  line: string;
  /** gate predicate (function) or condition string — stringified into `gate` */
  when?: unknown;
}

export interface PartyEntry {
  line: string;
  on?: unknown;
}

export interface PartyModule {
  crosstalk?: Record<string, PartyEntry[]>;
  objections?: Record<string, PartyEntry[]>;
}

export interface RoundnessNode {
  line?: string;
  tier?: number;
  trait?: string;
  [key: string]: unknown;
}

export interface PersonaModule {
  banter?: Record<string, BanterEntry[]>;
  tierUpLines?: Record<string, string[]>;
  ambient?: AmbientEntry[];
  observations?: ObservationFn[];
  canned?: Array<string | BanterEntryObj>;
  roundness?: Record<string, RoundnessNode>;
}

export type PersonasModule = Record<string, PersonaModule>;

function gateText(gate: unknown): string | undefined {
  if (gate === undefined || gate === null) return undefined;
  const text = String(gate).trim();
  return text.length > 0 ? text : undefined;
}

function mockJudgeStates(): unknown[] {
  return [
    { counters: { crashes: 0, blocksMined: 0, laps: 0, conversations: 0 }, biomes: [] },
    { counters: { crashes: 3, blocksMined: 50, laps: 5, conversations: 10 }, biomes: ['Gear Fields', 'Furnace Flats'] },
  ];
}

function evaluateObservations(fns: ObservationFn[]): Set<string> {
  const ctx = { tod: 'Night' };
  const observed = new Set<string>();

  for (const fn of fns) {
    for (const state of mockJudgeStates()) {
      try {
        const result = fn.length === 1 ? fn(state) : fn(state, undefined, ctx);
        if (typeof result === 'string' && result.trim()) {
          observed.add(result);
        }
      } catch {
        // observations may assume runtime state the mock lacks — skip
      }
    }
  }

  return observed;
}

export function extractLines(
  banterMod: BanterModule,
  tierUpMod: TierUpModule,
  observationsMod: ObservationFn[],
  rivetAmbientMod: AmbientEntry[],
  personasMod: PersonasModule,
  partMod: PartyModule
): ExtractedLine[] {
  const seen = new Set<string>();
  const lines: ExtractedLine[] = [];
  let nextId = 1;

  const add = (record: Omit<ExtractedLine, 'id'>) => {
    if (seen.has(record.text)) return;
    seen.add(record.text);
    const id = `L${String(nextId).padStart(4, '0')}`;
    nextId++;
    lines.push({ id, ...record });
  };

  // BANTER per pool key
  for (const [pool, entries] of Object.entries(banterMod ?? {})) {
    for (const entry of entries ?? []) {
      if (typeof entry === 'string') {
        add({ persona: 'rivet', bank: `banter.${pool}`, text: entry });
      } else {
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

  // TIER_UP_LINES
  for (const [key, entries] of Object.entries(tierUpMod ?? {})) {
    const tier = key === 'coworker' ? 1 : key === 'friend' ? 2 : 1;
    for (const entry of entries ?? []) {
      add({ persona: 'rivet', bank: `tierUp.${key}`, tier, text: entry });
    }
  }

  // OBSERVATIONS
  for (const text of evaluateObservations(observationsMod ?? [])) {
    add({ persona: 'rivet', bank: 'observation', text, evaluatedWith: 'mock-state' });
  }

  // RIVET_AMBIENT
  for (const entry of rivetAmbientMod ?? []) {
    add({
      persona: 'rivet',
      bank: 'ambient',
      text: entry.line,
      ...(gateText(entry.when) !== undefined ? { gate: gateText(entry.when) } : {}),
    });
  }

  // PERSONAS
  for (const [personaId, persona] of Object.entries(personasMod ?? {})) {
    if (!persona || typeof persona !== 'object') continue;

    // persona.banter
    for (const [pool, entries] of Object.entries(persona.banter ?? {})) {
      for (const entry of entries ?? []) {
        if (typeof entry === 'string') {
          add({ persona: personaId, bank: `persona.${personaId}.banter.${pool}`, text: entry });
        } else {
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

    // persona.tierUpLines
    for (const [key, entries] of Object.entries(persona.tierUpLines ?? {})) {
      for (const entry of entries ?? []) {
        add({ persona: personaId, bank: `persona.${personaId}.tierUp.${key}`, text: entry });
      }
    }

    // persona.ambient
    for (const entry of persona.ambient ?? []) {
      add({ persona: personaId, bank: `persona.${personaId}.ambient`, text: entry.line });
    }

    // persona.observations
    for (const text of evaluateObservations(persona.observations ?? [])) {
      add({ persona: personaId, bank: `persona.${personaId}.observation`, text, evaluatedWith: 'mock-state' });
    }

    // persona.canned
    for (const entry of persona.canned ?? []) {
      add({
        persona: personaId,
        bank: `persona.${personaId}.canned`,
        text: typeof entry === 'string' ? entry : entry.line,
      });
    }

    // persona.roundness — recursive walk
    const walkRoundness = (obj: RoundnessNode, prefix: string) => {
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
          walkRoundness(val as RoundnessNode, prefix ? `${prefix}.${key}` : key);
        }
      }
    };
    walkRoundness(persona.roundness ?? {}, '');
  }

  // CROSSTALK / OBJECTIONS from party.js
  for (const [bank, section] of [
    ['crosstalk', partMod?.crosstalk],
    ['objections', partMod?.objections],
  ] as Array<[string, Record<string, PartyEntry[]> | undefined]>) {
    for (const [personaId, entries] of Object.entries(section ?? {})) {
      for (const entry of entries ?? []) {
        add({
          persona: personaId,
          bank: `party.${bank}.${personaId}`,
          text: entry.line,
          ...(gateText(entry.on) !== undefined ? { gate: gateText(entry.on) } : {}),
        });
      }
    }
  }

  return lines;
}
