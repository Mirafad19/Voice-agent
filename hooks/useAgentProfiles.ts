
import { useState, useEffect, useCallback } from 'react';
import { AgentProfile } from '../types';
import { DEFAULT_PROFILES } from '../constants';

export const useAgentProfiles = () => {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfiles = useCallback(async () => {
    try {
      const response = await fetch('/api/profiles');
      const data: AgentProfile[] = await response.json();
      
      const userProfiles = data;

      if (userProfiles.length === 0) {
        const defaultProfile: AgentProfile = {
          ...DEFAULT_PROFILES[0],
          id: `custom-${Date.now()}`,
          name: 'My AI Assistant',
          ownerId: 'lite-user' 
        };
        await fetch('/api/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(defaultProfile)
        });
        setProfiles([defaultProfile]);
        setActiveProfileId(defaultProfile.id);
      } else {
        setProfiles(userProfiles);
        if (userProfiles.length > 0 && !activeProfileId) {
          setActiveProfileId(userProfiles[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching profiles:", error);
    } finally {
      setLoading(false);
    }
  }, [activeProfileId]);

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
      await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProfile)
      });
      setProfiles(prev => prev.map(p => p.id === updatedProfile.id ? updatedProfile : p));
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
      await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProfile)
      });
      setProfiles(prev => [...prev, newProfile]);
      setActiveProfileId(newProfile.id);
    } catch (error) {
      console.error("Error creating profile:", error);
    }
  }, []);

  const deleteProfile = useCallback(async (id: string) => {
    try {
      await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
      setProfiles(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error("Error deleting profile:", error);
    }
  }, []);

  const importProfiles = useCallback(async (newProfiles: AgentProfile[]) => {
      try {
        for (const profile of newProfiles) {
          const profileToSave = { ...profile, ownerId: 'lite-user' };
          await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileToSave)
          });
        }
        fetchProfiles();
      } catch (error) {
        console.error("Error importing profiles:", error);
      }
  }, [fetchProfiles]);

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
