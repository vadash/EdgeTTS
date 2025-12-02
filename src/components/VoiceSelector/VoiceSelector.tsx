import { narratorVoice } from '../../state/appState';
import voices from './voices';

export function VoiceSelector() {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: '#666' }}>
        Narrator Voice:
      </label>
      <select
        class="voices"
        id="voices"
        value={narratorVoice.value}
        onChange={(e) => narratorVoice.value = (e.target as HTMLSelectElement).value}
        style={{ width: '80%', borderRadius: '10px' }}
      >
        {voices.map((v) => (
          <option key={v.fullValue} value={v.fullValue}>
            {v.fullValue} ({v.gender})
          </option>
        ))}
      </select>
    </div>
  );
}
