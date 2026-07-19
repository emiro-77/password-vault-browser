// ============================================================================
// Password Vault Browser — Renderer Entry Point
// ============================================================================

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('app-root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
