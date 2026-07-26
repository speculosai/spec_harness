/**
 * The Vite entry point. Everything interesting is in BuilderPage.tsx - this
 * file only mounts it, the way your own router would.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BuilderPage } from './BuilderPage';

// One project per workspace. Your app supplies this id from your own data model;
// the example takes it from ?project= so you can keep more than one open, and
// BuilderPage creates one when there is nothing to open yet.
const projectId = new URLSearchParams(window.location.search).get('project') ?? undefined;

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing its #root element');

createRoot(root).render(
  <StrictMode>
    <BuilderPage projectId={projectId} />
  </StrictMode>,
);
