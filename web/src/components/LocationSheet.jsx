import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { Sheet, Icon, Spinner } from './ui';

/** Sets the origin point every distance in the app is measured from. */
export default function LocationSheet({ open, onClose }) {
  const { config, place, setPlace } = useApp();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Your browser does not support location sharing.');
      return;
    }
    setError('');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPlace({ name: 'Current location', lat: coords.latitude, lng: coords.longitude });
        setLocating(false);
        onClose();
      },
      () => {
        setError('Could not get your location. Pick an area instead.');
        setLocating(false);
      },
      { timeout: 8000 }
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title="Search from">
      <button
        onClick={useMyLocation}
        disabled={locating}
        className="w-full flex items-center gap-3 p-4 rounded-xl border border-ink hover:bg-ink hover:text-paper transition-colors disabled:opacity-50"
      >
        {locating ? <Spinner className="w-5 h-5" /> : <Icon name="pin" className="w-5 h-5" />}
        <span className="font-medium">{locating ? 'Finding you…' : 'Use my current location'}</span>
      </button>

      {error && <p className="mt-3 text-sm font-medium">{error}</p>}

      <p className="label mt-7 mb-3">Or pick an area</p>
      <div className="grid grid-cols-2 gap-2">
        {config.areas.map((a) => {
          const active = place.name === a.name;
          return (
            <button
              key={a.name}
              onClick={() => {
                setPlace({ name: a.name, lat: a.lat, lng: a.lng });
                onClose();
              }}
              className={`h-12 px-4 rounded-lg text-left text-[15px] font-medium transition-colors
                ${active ? 'bg-ink text-paper' : 'bg-mist hover:bg-line'}`}
            >
              {a.name}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
