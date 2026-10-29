import type { PermissionName, PermissionState, PermissionsService } from '@studio/platform-contracts';

type QueryDescriptor = { name: string; sysex?: boolean };

function mapState(state: string): PermissionState {
  return state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unknown';
}

export function createBrowserPermissions(nav: Navigator = navigator): PermissionsService {
  const query = async (descriptor: QueryDescriptor): Promise<PermissionState> => {
    if (!nav.permissions?.query) return 'unknown';
    try {
      const status = await nav.permissions.query(descriptor as unknown as PermissionDescriptor);
      return mapState(status.state);
    } catch {
      return 'unsupported';
    }
  };

  return {
    async query(name: PermissionName): Promise<PermissionState> {
      switch (name) {
        case 'microphone':
          if (!nav.mediaDevices?.getUserMedia) return 'unsupported';
          return query({ name: 'microphone' });
        case 'midi':
          if (!('requestMIDIAccess' in nav)) return 'unsupported';
          return query({ name: 'midi', sysex: false });
        case 'midi-sysex':
          if (!('requestMIDIAccess' in nav)) return 'unsupported';
          return query({ name: 'midi', sysex: true });
        case 'persistent-storage': {
          if (!nav.storage?.persisted) return 'unsupported';
          return (await nav.storage.persisted()) ? 'granted' : 'prompt';
        }
      }
    },
    async request(name: PermissionName): Promise<PermissionState> {
      if (name === 'persistent-storage') {
        if (!nav.storage?.persist) return 'unsupported';
        return (await nav.storage.persist()) ? 'granted' : 'denied';
      }
      // Microphone and MIDI prompts are triggered by the features that use them.
      return this.query(name);
    },
  };
}
