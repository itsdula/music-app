import '@fontsource-variable/inter';
import './landing.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LandingPage } from './landing/LandingPage';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
