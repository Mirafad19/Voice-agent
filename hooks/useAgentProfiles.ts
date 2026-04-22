
import { useState, useEffect, useCallback } from 'react';
import { AgentProfile } from '../types';
import { DEFAULT_PROFILES } from '../constants';

export const useAgentProfiles = () => {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Try to load from localStorage first for instant UI
      const localData = localStorage.getItem('agentProfiles');
      if (localData) {
        setProfiles(JSON.parse(localData));
      }

      // 2. Try to fetch from server as secondary (best effort)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      try {
        const response = await fetch('/api/profiles', { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const serverData = await response.json();
          if (Array.isArray(serverData) && serverData.length > 0) {
            setProfiles(serverData);
            localStorage.setItem('agentProfiles', JSON.stringify(serverData));
          }
        }
      } catch (err) {
        console.warn("Server sync failed:", err);
      }


      // 3. If still empty, create default
      setProfiles(current => {
        if (current.length === 0) {
          const defaultProfile: AgentProfile = {
            ...DEFAULT_PROFILES[0],
            id: `custom-${Date.now()}`,
            name: 'My AI Assistant',
            ownerId: 'lite-user' 
          };
          localStorage.setItem('agentProfiles', JSON.stringify([defaultProfile]));
          // Try to sync to server if possible
          fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(defaultProfile)
          }).catch(() => {}); // Ignore if serverless/offline
          return [defaultProfile];
        }
        return current;
      });
    } catch (error) {
      console.warn("API Fetch failed, using local cache:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    const foundProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || null;
    setActiveProfile(foundProfile);
  }, [activeProfileId, profiles]);

  const selectProfile = useCallback((id: string) => {
    setActiveProfileId(id);
  }, []);

  const updateProfile = useCallback(async (updatedProfile: AgentProfile) => {
    try {
      setProfiles(prev => {
        const next = prev.map(p => p.id === updatedProfile.id ? updatedProfile : p);
        localStorage.setItem('agentProfiles', JSON.stringify(next));
        return next;
      });
      await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProfile)
      });
    } catch (error) {
      console.error("Error updating profile:", error);
    }
  }, []);
  
  const createProfile = useCallback(async (name: string) => {
    const newProfile: AgentProfile = {
        ...DEFAULT_PROFILES[0],
        id: `custom-${Date.now()}`,
        name,
        calloutMessage: 'Hey! Click me to start a voice chat.',
        emailConfig: { formspreeEndpoint: '' },
        fileUploadConfig: { cloudinaryCloudName: '', cloudinaryUploadPreset: '' },
        ownerId: 'lite-user'
    };
    try {
      setProfiles(prev => {
        const next = [...prev, newProfile];
        localStorage.setItem('agentProfiles', JSON.stringify(next));
        return next;
      });
      setActiveProfileId(newProfile.id);
      await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProfile)
      });
    } catch (error) {
      console.error("Error creating profile:", error);
    }
  }, []);

  const deleteProfile = useCallback(async (id: string) => {
    try {
      setProfiles(prev => {
        const next = prev.filter(p => p.id !== id);
        localStorage.setItem('agentProfiles', JSON.stringify(next));
        return next;
      });
      await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
    } catch (error) {
      console.error("Error deleting profile:", error);
    }
  }, []);

  const importProfiles = useCallback(async (newProfiles: AgentProfile[]) => {
      try {
        setProfiles(newProfiles);
        localStorage.setItem('agentProfiles', JSON.stringify(newProfiles));
        
        for (const profile of newProfiles) {
          const profileToSave = { ...profile, ownerId: 'lite-user' };
          await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileToSave)
          }).catch(() => {});
        }
      } catch (error) {
        console.error("Error importing profiles:", error);
      }
  }, []);

  return {
    profiles,
    activeProfile,
    selectProfile,
    updateProfile,
    createProfile,
    deleteProfile,
    importProfiles,
    loading
  };
};
