/**
 * The Vite entry point. Everything interesting is in BuilderPage.tsx - this
 * file only mounts it, the way your own router would.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BuilderPage } from './BuilderPage';

// One project per workspace. Your app supplies this id; the example takes it
// from ?project= so you can open more than one.
const projectId = new URLSearchParams(window.location.search).get('project') ?? 'northwind-demo';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BuilderPage projectId={projectId} />
  </StrictMode>,
);
