import { useRef, useEffect, useState } from "react";
import { useJsApiLoader } from "@react-google-maps/api";
import { Input } from "./ui/input";
import { MapPin } from "lucide-react";

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
  /** "address" (default) or "cities" to search for cities/localities */
  searchType?: "address" | "cities";
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const LIBRARIES: ("places")[] = ["places"];

interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = "Buscar dirección...",
  id = "address",
  className,
  disabled,
  searchType = "address",
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const skipNextSearch = useRef(false);

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: apiKey || " ",
    libraries: LIBRARIES,
    preventGoogleFontsLoading: true,
  });

  // Initialize services once the API is loaded
  useEffect(() => {
    if (!apiKey || !isLoaded || loadError) return;

    autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
    // PlacesService needs a div (not displayed)
    const div = document.createElement("div");
    placesServiceRef.current = new google.maps.places.PlacesService(div);

    return () => {
      autocompleteServiceRef.current = null;
      placesServiceRef.current = null;
    };
  }, [isLoaded, loadError]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchPredictions = (input: string) => {
    if (!autocompleteServiceRef.current || input.length < 3) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    autocompleteServiceRef.current.getPlacePredictions(
      {
        input,
        componentRestrictions: { country: "ar" },
        types: searchType === "cities" ? ["(cities)"] : ["address"],
      },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          setPredictions(
            results.map((r) => ({
              placeId: r.place_id,
              description: r.description,
              mainText: r.structured_formatting.main_text,
              secondaryText: r.structured_formatting.secondary_text,
            }))
          );
          setShowDropdown(true);
          setActiveIndex(-1);
        } else {
          setPredictions([]);
          setShowDropdown(false);
        }
      }
    );
  };

  const handleInputChange = (newValue: string) => {
    onChange(newValue);

    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(newValue), 300);
  };

  const selectPrediction = (prediction: Prediction) => {
    skipNextSearch.current = true;
    onChange(prediction.description);
    setShowDropdown(false);
    setPredictions([]);

    // Get place details (coordinates)
    if (placesServiceRef.current && onPlaceSelect) {
      placesServiceRef.current.getDetails(
        { placeId: prediction.placeId, fields: ["geometry", "formatted_address"] },
        (place, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
            onPlaceSelect({
              address: place.formatted_address || prediction.description,
              lat: place.geometry.location.lat(),
              lon: place.geometry.location.lng(),
            });
          }
        }
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || predictions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i < predictions.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : predictions.length - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectPrediction(predictions[activeIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  if (!apiKey || loadError) {
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
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        type="text"
        placeholder={isLoaded ? placeholder : "Cargando autocompletado..."}
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (predictions.length > 0) setShowDropdown(true);
        }}
        className={className}
        disabled={disabled || !isLoaded}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown && predictions.length > 0}
        aria-controls="address-autocomplete-list"
        aria-activedescendant={activeIndex >= 0 ? `address-option-${activeIndex}` : undefined}
      />

      {showDropdown && predictions.length > 0 && (
        <div id="address-autocomplete-list" role="listbox" className="absolute z-[10000] left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {predictions.map((prediction, index) => (
            <button
              key={prediction.placeId}
              id={`address-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`w-full flex items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                index === activeIndex
                  ? "bg-amber-50"
                  : "hover:bg-gray-50"
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                selectPrediction(prediction);
              }}
            >
              <MapPin size={16} className="text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{prediction.mainText}</p>
                <p className="text-xs text-muted-foreground truncate">{prediction.secondaryText}</p>
              </div>
            </button>
          ))}
          <div className="px-3 py-1.5 border-t border-gray-100 flex justify-end">
            <img
              src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3_hdpi.png"
              alt="Powered by Google"
              className="h-3.5"
            />
          </div>
        </div>
      )}
    </div>
  );
}
