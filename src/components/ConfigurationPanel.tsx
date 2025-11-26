
import React, { useState, useEffect, useMemo } from 'react';
import { AgentProfile, WidgetTheme, AgentVoice, AccentColor, EmailConfig, FileUploadConfig } from '../types';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Button } from './ui/Button';

interface ConfigurationPanelProps {
  profile: AgentProfile;
  onProfileChange: (updatedProfile: AgentProfile) => void;
}

const accentColorOptions = [
    { name: 'Red', value: AccentColor.Red, color: 'bg-accent-red' },
    { name: 'Orange', value: AccentColor.Orange, color: 'bg-accent-orange' },
    { name: 'Gold', value: AccentColor.Gold, color: 'bg-accent-gold' },
    { name: 'Cyan', value: AccentColor.Cyan, color: 'bg-accent-cyan' },
    { name: 'Pink', value: AccentColor.Pink, color: 'bg-accent-pink' },
    { name: 'Lime', value: AccentColor.Lime, color: 'bg-accent-lime' },
    { name: 'Violet', value: AccentColor.Violet, color: 'bg-accent-violet' },
    { name: 'Teal', value: AccentColor.Teal, color: 'bg-accent-teal' },
    { name: 'Emerald', value: AccentColor.Emerald, color: 'bg-accent-emerald' },
    { name: 'Sky', value: AccentColor.Sky, color: 'bg-accent-sky' },
    { name: 'Rose', value: AccentColor.Rose, color: 'bg-accent-rose' },
    { name: 'Black', value: AccentColor.Black, color: 'bg-accent-black' },
];

export const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({ profile, onProfileChange }) => {
  const [editedProfile, setEditedProfile] = useState<AgentProfile>(profile);

  useEffect(() => {
    setEditedProfile(profile);
  }, [profile]);

  const hasChanges = useMemo(() => {
    return JSON.stringify(profile) !== JSON.stringify(editedProfile);
  }, [profile, editedProfile]);

  const handleChange = <K extends keyof AgentProfile,>(key: K, value: AgentProfile[K]) => {
    setEditedProfile(prev => ({ ...prev, [key]: value }));
  };

  const handleEmailConfigChange = <K extends keyof EmailConfig,>(key: K, value: EmailConfig[K]) => {
    setEditedProfile(prev => ({
      ...prev,
      emailConfig: {
        ...(prev.emailConfig || { formspreeEndpoint: '' }),
        [key]: typeof value === 'string' ? value.trim() : value
      }
    }));
  };

  const handleFileUploadConfigChange = <K extends keyof FileUploadConfig,>(key: K, value: FileUploadConfig[K]) => {
    // Auto-trim whitespace from Cloudinary configs to prevent "Unknown API Key" errors
    const cleanValue = typeof value === 'string' ? value.trim() : value;
    
    setEditedProfile(prev => ({
      ...prev,
      fileUploadConfig: {
        ...(prev.fileUploadConfig || { cloudinaryCloudName: '', cloudinaryUploadPreset: '' }),
        [key]: cleanValue
      }
    }));
  };

  const handleSave = () => {
    onProfileChange(editedProfile);
  };

  const handleReset = () => {
    setEditedProfile(profile);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="space-y-6">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Agent Configuration</h3>
        
        <Input
          label="Agent Name"
          id="agentName"
          value={editedProfile.name}
          onChange={(e) => handleChange('name', e.target.value)}
        />

        <div>
          <Input
            label="Widget Callout Message"
            id="calloutMessage"
            value={editedProfile.calloutMessage || ''}
            onChange={(e) => handleChange('calloutMessage', e.target.value)}
            placeholder="e.g., Hey there! How can I help?"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">A short, friendly message that appears above the widget button to encourage users to click.</p>
        </div>

        <div>
          <Input
            label="Agent's Initial Greeting"
            id="initialGreeting"
            value={editedProfile.initialGreeting || ''}
            onChange={(e) => handleChange('initialGreeting', e.target.value)}
            placeholder="e.g., Hello, how can I help you today?"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The first thing the agent says to start the conversation. This will be spoken out loud.</p>
        </div>

        <div>
          <label htmlFor="knowledgeBase" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Knowledge Base (System Instruction)
          </label>
          <textarea
            id="knowledgeBase"
            rows={8}
            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
            value={editedProfile.knowledgeBase}
            onChange={(e) => handleChange('knowledgeBase', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Select
            label="Theme"
            id="theme"
            value={editedProfile.theme}
            onChange={(e) => handleChange('theme', e.target.value as WidgetTheme)}
          >
            <option value={WidgetTheme.Light}>Light</option>
            <option value={WidgetTheme.Dark}>Dark</option>
          </Select>

          <Select
            label="Agent Voice"
            id="voice"
            value={editedProfile.voice}
            onChange={(e) => handleChange('voice', e.target.value as AgentVoice)}
          >
            {Object.values(AgentVoice).map(voice => (
              <option key={voice} value={voice}>{voice}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Accent Color
          </label>
          <div className="flex flex-wrap items-center gap-3">
            {accentColorOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className={`w-8 h-8 rounded-full ${option.color} transition-transform transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-800 focus:ring-${option.value}-500 ${editedProfile.accentColor === option.value ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-black dark:ring-white' : ''}`}
                onClick={() => handleChange('accentColor', option.value)}
                title={option.name}
              />
            ))}
          </div>
        </div>

        <details className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <summary className="font-semibold cursor-pointer text-gray-900 dark:text-white">Cloud Audio Storage (via Cloudinary)</summary>
          <div className="mt-4 space-y-4 text-sm text-gray-600 dark:text-gray-400">
              <p>
                  To include a playable audio link in email reports, the app uploads recordings to cloud storage. This method uses a free <a href="https://cloudinary.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Cloudinary</a> account, which is simpler and more reliable than other options.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Input
                      label="Cloudinary Cloud Name"
                      id="cloudinaryCloudName"
                      type="text"
                      placeholder="Your Cloudinary cloud name"
                      value={editedProfile.fileUploadConfig?.cloudinaryCloudName || ''}
                      onChange={(e) => handleFileUploadConfigChange('cloudinaryCloudName', e.target.value)}
                  />
                  <Input
                      label="Cloudinary Upload Preset"
                      id="cloudinaryUploadPreset"
                      type="text"
                      placeholder="Your Cloudinary unsigned preset"
                      value={editedProfile.fileUploadConfig?.cloudinaryUploadPreset || ''}
                      onChange={(e) => handleFileUploadConfigChange('cloudinaryUploadPreset', e.target.value)}
                  />
              </div>
              <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md border border-gray-200 dark:border-gray-700">
                  <h4 className="font-semibold text-gray-900 dark:text-white">Setup Instructions:</h4>
                  <ol className="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300">
                      <li>Create or log in to your <a href="https://cloudinary.com/users/register/free" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">free Cloudinary Account</a>.</li>
                      <li>From your main Dashboard, copy the <strong>Cloud Name</strong> and paste it into the field above.</li>
                      <li>Go to Settings by clicking the gear icon in the sidebar, then navigate to the <strong>Upload</strong> tab.</li>
                      <li>Scroll down to the "Upload presets" section and click <strong>Add upload preset</strong>.</li>
                      <li>Change the "Signing Mode" from "Signed" to <strong>"Unsigned"</strong>. This is the most important step.</li>
                      <li>(Optional) You can give the preset a more memorable name.</li>
                      <li>Click <strong>Save</strong> at the top of the page.</li>
                      <li>Copy the <strong>Upload preset name</strong> from the list and paste it into the field above. You're all set!</li>
                  </ol>
              </div>
              <div className="mt-4 space-y-3 p-4 bg-yellow-50 dark:bg-yellow-900/50 rounded-md border border-yellow-300 dark:border-yellow-700">
                  <h4 className="font-semibold text-yellow-900 dark:text-yellow-200">Troubleshooting</h4>
                  <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      If your email report shows an "Audio link not available: Failed to fetch" error, it's often caused by a security policy on your website.
                  </p>
                  <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      <strong>Content Security Policy (CSP):</strong> If your website uses a CSP, it might be blocking the connection to Cloudinary. To fix this, you must add Cloudinary's API endpoint to your policy's <code className="bg-yellow-200 dark:bg-yellow-800/50 px-1 py-0.5 rounded">connect-src</code> directive.
                      <br />
                      Example: <code className="text-xs bg-yellow-200 dark:bg-yellow-800/50 px-1 py-0.5 rounded">connect-src 'self' https://api.cloudinary.com;</code>
                  </p>
                  <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      Browser extensions like ad-blockers can also sometimes interfere with the upload.
                  </p>
              </div>
          </div>
        </details>

        <details className="border border-gray-200 dark:border-gray-700 rounded-lg p-4" open>
            <summary className="font-semibold cursor-pointer text-gray-900 dark:text-white">Automated Email Reports (via Formspree)</summary>
            <div className="mt-4 space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    This app uses <a href="https://formspree.io/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Formspree</a>, a free service, to automatically send email reports after a session.
                </p>
                <Input
                    label="Formspree Endpoint URL"
                    id="formspreeEndpoint"
                    type="url"
                    placeholder="https://formspree.io/f/your_form_id"
                    value={editedProfile.emailConfig?.formspreeEndpoint || ''}
                    onChange={(e) => handleEmailConfigChange('formspreeEndpoint', e.target.value)}
                />
                <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md border border-gray-200 dark:border-gray-700">
                    <h4 className="font-semibold text-gray-900 dark:text-white">Setup Instructions:</h4>
                    <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 dark:text-gray-300">
                        <li>Sign up for a <a href="https://formspree.io/register" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">free Formspree account</a> and verify your email.</li>
                        <li>On your dashboard, click <strong>+ New form</strong>.</li>
                        <li>Give your form a name (e.g., "AI Agent Reports") and enter the email address where you want to receive reports. Click <strong>Create Form</strong>.</li>
                        <li>You'll be taken to the form's <strong>Integration</strong> tab. Copy the full <strong>Endpoint URL</strong> provided.</li>
                        <li>Paste the URL into the field above and save your changes. You're all set!</li>
                    </ol>
                </div>
                
                <div className="mt-4 space-y-3 p-4 bg-blue-50 dark:bg-blue-900/50 rounded-md border border-blue-200 dark:border-blue-700">
                    <h4 className="font-semibold text-blue-900 dark:text-blue-200">⚠️ Not receiving emails?</h4>
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                        If the app says "Report sent successfully" but you don't see it in your Inbox:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-blue-800 dark:text-blue-300">
                        <li>Check your <strong>Formspree Dashboard</strong> &gt; <strong>Submissions</strong> tab.</li>
                        <li>Look in the <strong>Spam</strong> folder there.</li>
                        <li>If you see the report, select it and click <strong>"Not Spam"</strong>.</li>
                        <li>This trains Formspree to trust your app, and future emails will arrive in your Gmail Inbox instantly.</li>
                    </ul>
                </div>
            </div>
        </details>
      </div>

      <div className="flex justify-end items-center space-x-4 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
        <span className={`text-sm text-gray-500 dark:text-gray-400 transition-opacity ${hasChanges ? 'opacity-100' : 'opacity-0'}`}>
            You have unsaved changes.
        </span>
        <Button onClick={handleReset} variant="secondary" disabled={!hasChanges}>
          Reset
        </Button>
        <Button onClick={handleSave} disabled={!hasChanges}>
          Save Configuration
        </Button>
      </div>
    </div>
  );
};
