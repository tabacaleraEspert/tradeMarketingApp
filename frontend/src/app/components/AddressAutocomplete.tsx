import { useRef, useEffect, useState } from "react";
import { useJsApiLoader } from "@react-google-maps/api";
import { Input } from "./ui/input";

export interface AddressResult {
  address: string;
  lat: number;
  lon: number;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string) => void;
  onPlaceSelect?: (result: AddressResult) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = "Buscar dirección...",
  id = "address",
  className,
  disabled,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: apiKey || " ",
    libraries: ["places"],
    preventGoogleFontsLoading: true,
  });

  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!apiKey || !isLoaded || loadError || !inputRef.current) return;

    if (autocompleteRef.current) {
      autocompleteRef.current = null;
    }

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      fields: ["formatted_address", "geometry", "name"],
      types: ["address"],
    });

    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      const addr = place.formatted_address || place.name || "";
      if (addr) {
        onChange(addr);
      }
      if (place.geometry?.location && onPlaceSelect) {
        const lat = place.geometry.location.lat();
        const lon = place.geometry.location.lng();
        onPlaceSelect({ address: addr, lat, lon });
      }
    });

    autocompleteRef.current = autocomplete;
    setIsReady(true);

    return () => {
      if (listener) google.maps.event.removeListener(listener);
      autocompleteRef.current = null;
      setIsReady(false);
    };
  }, [apiKey, isLoaded, loadError, onChange, onPlaceSelect]);

  if (!apiKey) {
    return (
      <Input
        ref={inputRef}
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        disabled={disabled}
      />
    );
  }

  if (loadError) {
    return (
      <Input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        type="text"
        placeholder={isLoaded ? placeholder : "Cargando autocompletado..."}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        disabled={disabled || !isLoaded}
        autoComplete="off"
      />
    </div>
  );
}
