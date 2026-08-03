// The hub menu's ONE vocabulary (collecte 2026-08-03: the Bubble overlay
// and the hosted App each hardcoded the six items, and three subtitles had
// already drifted apart). Both call sites now build from this list — they
// only differ in their handlers, which IS the real difference between them.
import {type MenuItem} from '../../screens/MenuScreen';

export type MenuAction =
  | 'assistant'
  | 'library'
  | 'currentDoc'
  | 'currentPage'
  | 'config'
  | 'guide';

export const MENU_VOCAB: ReadonlyArray<{
  key: MenuAction;
  label: string;
  sub: string;
}> = [
  {
    key: 'assistant',
    label: '💬 Open the assistant',
    // Keeps the fullest of the two old wordings (audit 2026-08-03 #2: the
    // dedup had dropped "the whole note", a scope both surfaces support).
    sub: 'Chat about the current page, a range, the whole note or a lasso',
  },
  {
    key: 'library',
    label: '📚 Library: Sync, Search & Export',
    sub: 'Sync status · browse, search and export your transcripts',
  },
  {
    key: 'currentDoc',
    label: '📄 Current note transcript',
    sub: 'The note / PDF you have open, in the Library',
  },
  {
    key: 'currentPage',
    label: '📃 Current page transcript',
    sub: 'The exact page you are on',
  },
  {
    key: 'config',
    label: '⚙ Plugin configuration',
    sub: 'API key · READ · CHAT & agents',
  },
  {
    key: 'guide',
    label: '📖 User manual (PDF)',
    sub: 'Open the embedded guide',
  },
];

export const buildMenuItems = (
  handlers: Record<MenuAction, () => void>,
): MenuItem[] =>
  MENU_VOCAB.map(v => ({label: v.label, sub: v.sub, onPress: handlers[v.key]}));
