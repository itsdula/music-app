import '@studio/react/styles.css';
import { Studio } from '@studio/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
);
