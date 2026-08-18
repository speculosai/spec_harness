/**
 * The entry point, exactly as a generated project mounts one: find `#root` in the
 * preview document, hand it to React 18's `createRoot`, render the app.
 *
 * This file does not change again for the rest of the demo - every later version keeps
 * the same entry and grows around it.
 */
import { createRoot } from 'react-dom/client';

import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('the preview document has no #root element');

createRoot(container).render(<App />);
