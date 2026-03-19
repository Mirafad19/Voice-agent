
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AgentWidget } from './components/AgentWidget';
import { AgentConfig } from './types';
import { safeAtob } from './utils';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}
const root = ReactDOM.createRoot(rootElement);

const urlParams = new URLSearchParams(window.location.search);
const configParam = urlParams.get('config');

if (configParam) {
  try {
    const decodedConfig = safeAtob(configParam);
    const agentConfig: AgentConfig = JSON.parse(decodedConfig);
    const apiKeyParam = urlParams.get('apiKey');

    // Complete CSS isolation for widget mode - reset all inherited styles
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      /* Complete isolation from host page styles */
      html, body, #root {
        all: initial;
        box-sizing: border-box;
      }

      html {
        background-color: transparent !important;
        overflow: hidden !important;
      }

      body {
        background-color: transparent !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      }

      #root {
        display: block !important;
        width: 100vw !important;
        height: 100vh !important;
        min-height: 100% !important;
        background-color: transparent !important;
        overflow: hidden !important;
      }

      /* Prevent any inherited styles */
      * {
        box-sizing: border-box !important;
      }

      /* Ensure all interactive elements have proper defaults */
      button {
        background: none !important;
        border: none !important;
        padding: 0 !important;
        margin: 0 !important;
        cursor: pointer !important;
        font: inherit !important;
        color: inherit !important;
      }

      input, textarea {
        font: inherit !important;
        color: inherit !important;
        background: none !important;
      }

      /* SVG isolation */
      svg {
        display: inline-block !important;
        vertical-align: baseline !important;
      }
    `;
    document.head.appendChild(styleEl);

    // Also set inline styles for redundancy
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    rootElement.style.height = '100vh';
    rootElement.style.width = '100vw';
    rootElement.style.backgroundColor = 'transparent';

    root.render(
      <React.StrictMode>
        <AgentWidget
          agentProfile={agentConfig}
          apiKey={apiKeyParam || process.env.GEMINI_API_KEY || ''}
          isWidgetMode={true}
        />
      </React.StrictMode>
    );
  } catch (error) {
    console.error("Failed to parse widget config:", error);
    root.render(
      <div style={{ padding: '1rem', color: 'red', fontFamily: 'sans-serif' }}>
        <h2>Error</h2>
        <p>Invalid configuration provided in URL.</p>
      </div>
    );
  }
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
