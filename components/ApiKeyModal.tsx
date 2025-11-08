
import React, { useState } from 'react';

interface ApiKeyModalProps {
  onApiKeySubmit: (apiKey: string) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onApiKeySubmit }) => {
  const [apiKey, setApiKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.trim()) {
      onApiKeySubmit(apiKey.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-80 backdrop-blur-md">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md mx-4">
        <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Enter Your Gemini API Key</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          To use the AI Voice Agent, please provide your Google Gemini API key. It will be stored securely in your browser's local storage.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            placeholder="Enter your API key"
            required
          />
          <button
            type="submit"
            className="w-full mt-6 bg-indigo-600 text-white py-3 rounded-md font-semibold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            Save and Continue
          </button>
        </form>
      </div>
    </div>
  );
};
