const CATEGORY_COLORS = {
  World: "#7c3aed",
  National: "#10b981",
  Trending: "#00d4ff",
  WorthReading: "#ff6b35"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countryCodeFromFeature(feature) {
  return (
    feature?.id ||
    feature?.properties?.iso_a3 ||
    feature?.properties?.ISO_A3 ||
    feature?.properties?.adm0_a3 ||
    null
  );
}

function isValidPoint(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

export function initializeMap(options = {}) {
  if (!window.L) {
    return {
      update() {},
      setSelectedCountry() {},
      clearSelection() {},
      getSelectedCountry() {
        return null;
      }
    };
  }

  const {
    elementId = "world-map",
    onCountrySelect = () => {},
    onCountryClear = () => {}
  } = options;

  const map = L.map(elementId, {
    minZoom: 2,
    maxZoom: 8,
    worldCopyJump: true,
    zoomControl: true
  }).setView([20, 0], 2);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
  }).addTo(map);

  const markers = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 42
  });
  map.addLayer(markers);

  let selectedCountry = null;
  let worldLayer = null;

  function countryStyle(feature) {
    const code = countryCodeFromFeature(feature);
    const isSelected = selectedCountry && code === selectedCountry;
    return {
      color: isSelected ? "#00d4ff" : "#27272a",
      weight: isSelected ? 1.5 : 0.8,
      fillColor: isSelected ? "#0ea5e9" : "#111111",
      fillOpacity: isSelected ? 0.45 : 0.22
    };
  }

  function refreshWorldStyles() {
    if (worldLayer) {
      worldLayer.setStyle(countryStyle);
    }
  }

  function setSelectedCountry(code, emit = true) {
    selectedCountry = code || null;
    refreshWorldStyles();

    if (emit) {
      if (selectedCountry) {
        onCountrySelect(selectedCountry);
      } else {
        onCountryClear();
      }
    }
  }

  function bindCountryFeature(feature, layer) {
    layer.on("mouseover", () => {
      layer.setStyle({
        weight: 1.4,
        color: "#3f3f46"
      });
    });

    layer.on("mouseout", () => {
      refreshWorldStyles();
    });

    layer.on("click", () => {
      const code = countryCodeFromFeature(feature);
      if (!code) {
        return;
      }

      if (selectedCountry === code) {
        setSelectedCountry(null, true);
      } else {
        setSelectedCountry(code, true);
      }
    });
  }

  async function loadWorldLayer() {
    try {
      const response = await fetch("assets/world.geo.json");
      if (!response.ok) {
        return;
      }

      const geoJson = await response.json();
      worldLayer = L.geoJSON(geoJson, {
        style: countryStyle,
        onEachFeature: bindCountryFeature
      });
      worldLayer.addTo(map);
    } catch (error) {
      console.warn("Failed to load world geojson", error);
    }
  }

  function update(articles) {
    markers.clearLayers();

    const bounds = [];
    for (const article of articles) {
      const geotag = article?.geotag || {};
      const lat = Number.parseFloat(geotag.lat);
      const lng = Number.parseFloat(geotag.lng);
      const country = String(geotag.country || "UNK").toUpperCase();

      if (!isValidPoint(lat, lng) || country === "UNK") {
        continue;
      }

      const color = CATEGORY_COLORS[article.category] || "#94a3b8";
      const marker = L.circleMarker([lat, lng], {
        radius: 7,
        color,
        weight: 1.2,
        fillColor: color,
        fillOpacity: 0.8
      });

      marker.bindPopup(
        [
          `<strong>${escapeHtml(article.title)}</strong>`,
          `<div>${escapeHtml(article.sourceName)}</div>`,
          `<div>${escapeHtml(country)}</div>`
        ].join("")
      );

      marker.on("click", () => {
        if (selectedCountry === country) {
          setSelectedCountry(null, true);
        } else {
          setSelectedCountry(country, true);
        }
      });

      markers.addLayer(marker);
      bounds.push([lat, lng]);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, {
        padding: [18, 18],
        maxZoom: 3
      });
    } else {
      map.setView([20, 0], 2);
    }
  }

  loadWorldLayer();

  return {
    update,
    setSelectedCountry(code) {
      setSelectedCountry(code, false);
    },
    clearSelection() {
      setSelectedCountry(null, true);
    },
    getSelectedCountry() {
      return selectedCountry;
    }
  };
}
