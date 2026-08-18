/**
 * The Vite entry point.
 *
 * The mock backend is installed before anything renders, because `<HarnessProvider>`
 * asks for `/capabilities` the moment it mounts - a request that escaped to the network
 * would come back as the dev server's index.html, and the client would quietly fall
 * back to protocol-1 defaults.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@speculosai/spec_harness/styles.css';

import { App } from './App';
import { installDemoBackend } from './mock/browser';
import './landing.css';

installDemoBackend();

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing its #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
