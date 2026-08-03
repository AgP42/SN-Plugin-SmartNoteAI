// Shared helpers for the component smoke harness (UI refactor Lot 0,
// 2026-08-03). React Native fragments a <Text>a {b} c</Text> into
// several children, so substring assertions must run on the FLATTENED
// text, and pressables are found by their flattened label — never by
// JSON.stringify (test instances are circular).
import type {ReactTestInstance, ReactTestRenderer} from 'react-test-renderer';
import {act} from 'react-test-renderer';

type JsonNode =
  | string
  | null
  | {children?: JsonNode[] | null}
  | JsonNode[];

// Every string in the rendered tree, joined — for `toContain` checks.
export const flatText = (r: ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (n: JsonNode): void => {
    if (n === null) {
      return;
    }
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  walk(r.toJSON() as JsonNode);
  return out.join('');
};

// Flattened text of ONE test instance (labels of a specific pressable).
export const instanceText = (node: ReactTestInstance): string => {
  const out: string[] = [];
  const walk = (c: ReactTestInstance | string): void => {
    if (typeof c === 'string') {
      out.push(c);
      return;
    }
    for (const k of c.children) {
      walk(k);
    }
  };
  walk(node);
  return out.join('');
};

// Find the pressable whose flattened label contains `label` and press it.
export const pressByText = (r: ReactTestRenderer, label: string): void => {
  const btn = r.root
    .findAll(n => typeof n.props.onPress === 'function')
    .find(n => instanceText(n).includes(label));
  if (btn === undefined) {
    throw new Error(`no pressable containing "${label}"`);
  }
  act(() => {
    btn.props.onPress();
  });
};
