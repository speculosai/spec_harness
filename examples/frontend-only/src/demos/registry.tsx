/**
 * The three demos, in the order the landing page lists them.
 *
 * This is the single place a fourth vertical is registered: add a directory next to
 * these three, import its `demo`, and the landing page, the router and the mock
 * backend all pick it up - there is no other list to keep in step.
 */

import type { VerticalDemo } from '../mock/types';
import { demo as property } from './property/demo';
import { demo as commerce } from './commerce/demo';
import { demo as factory } from './factory/demo';

/** Every demo the app knows about. */
export const demos: VerticalDemo[] = [property, commerce, factory];

/** Look one up by the id in the URL hash. */
export function demoById(id: string): VerticalDemo | undefined {
  return demos.find((demo) => demo.definition.id === id);
}
