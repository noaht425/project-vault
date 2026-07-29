// Shared between main (local vault note creation) and renderer (file-tree
// "create" buttons, and cloud note creation which has no main-process
// default-computing step of its own) — kept here rather than duplicated
// per call site now that there are three of them.
import { defaultPcFrontmatter } from './noteTypes/pc'
import { defaultNpcFrontmatter } from './noteTypes/npc'
import { defaultClassReferenceFrontmatter } from './noteTypes/classReference'
import { defaultSessionFrontmatter } from './noteTypes/session'
import { defaultEventFrontmatter } from './noteTypes/event'
import { defaultFactionFrontmatter } from './noteTypes/faction'
import { defaultItemFrontmatter } from './noteTypes/item'
import { defaultLocationFrontmatter } from './noteTypes/location'
import { defaultLanguageFrontmatter } from './noteTypes/language'
import { defaultFamilyTreeFrontmatter } from './noteTypes/familyTree'
import { defaultSettlementFrontmatter } from './noteTypes/settlement'
import { defaultCalendarFrontmatter } from './noteTypes/calendar'
import { defaultClimateFrontmatter } from './noteTypes/climate'
import type { NoteTemplate } from './types'

export const TEMPLATE_DEFAULTS: Partial<Record<NoteTemplate, () => Record<string, unknown>>> = {
  pc: defaultPcFrontmatter,
  npc: defaultNpcFrontmatter,
  'class-reference': defaultClassReferenceFrontmatter,
  session: defaultSessionFrontmatter,
  event: defaultEventFrontmatter,
  faction: defaultFactionFrontmatter,
  item: defaultItemFrontmatter,
  location: defaultLocationFrontmatter,
  language: defaultLanguageFrontmatter,
  'family-tree': defaultFamilyTreeFrontmatter,
  settlement: defaultSettlementFrontmatter,
  calendar: defaultCalendarFrontmatter,
  climate: defaultClimateFrontmatter
}

export const TEMPLATE_STARTER_BODY: Partial<Record<NoteTemplate, string>> = {
  'class-reference':
    '\n*Add a "## Level N" heading for each level this subclass actually gets a feature at — skip any that don\'t apply.*\n\n',
  language: '\n*Add a "## Word: word" heading for each dictionary entry as you build up vocabulary.*\n\n',
  'family-tree':
    '\n*Add a "## Relationships" heading, then list people with [[wiki-links]] — e.g. "- [[Parent]] parent of [[Child]]", "- [[A]] spouse of [[B]]", "- [[A]] sibling of [[B]]".*\n\n'
}

export type CreateKind = NoteTemplate | 'folder'

export const CREATE_PLACEHOLDERS: Record<CreateKind, string> = {
  note: 'Note name…',
  pc: 'Character name…',
  npc: 'NPC name…',
  'class-reference': 'e.g. Fighter — Champion',
  session: 'e.g. Session 12 — The Sunken Temple',
  event: 'e.g. The Sundering',
  faction: 'Faction name…',
  item: 'Item name…',
  location: 'Location name…',
  language: 'Language name…',
  'family-tree': 'e.g. The Stormwind Family',
  settlement: 'Settlement name…',
  calendar: 'Calendar name…',
  climate: 'e.g. Arctic Tundra',
  folder: 'Folder name…'
}

// Friendly labels for the "New" dropdown menu (see NewItemMenu.tsx) — same
// keys as CREATE_PLACEHOLDERS, just menu-item text instead of input hints.
export const CREATE_LABELS: Record<CreateKind, string> = {
  note: 'Note',
  pc: 'PC',
  npc: 'NPC',
  'class-reference': 'Class Reference',
  session: 'Session',
  event: 'Event',
  faction: 'Faction',
  item: 'Item',
  location: 'Location',
  language: 'Language',
  'family-tree': 'Family Tree',
  settlement: 'Settlement',
  calendar: 'Calendar',
  climate: 'Climate',
  folder: 'Folder'
}

// Display order for the "New" dropdown's note-type entries — Folder is
// handled separately (own section of the menu, after a divider).
export const CREATABLE_NOTE_KINDS: NoteTemplate[] = [
  'note',
  'pc',
  'npc',
  'class-reference',
  'session',
  'event',
  'faction',
  'item',
  'location',
  'language',
  'family-tree',
  'settlement',
  'calendar',
  'climate'
]
