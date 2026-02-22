const CATEGORY_COLORS = {
  World: "#7c3aed",
  National: "#10b981",
  Trending: "#0891b2",
  WorthReading: "#f97316"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setMapPlaceholder(elementId, message) {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.innerHTML = `
    <div class="map-empty-state">
      <strong>Map unavailable</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
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

function appendCoordinatePairs(container, coordinates) {
  for (const point of coordinates) {
    if (!Array.isArray(point)) {
      continue;
    }

    if (typeof point[0] === "number" && typeof point[1] === "number") {
      container.push(point);
    } else {
      appendCoordinatePairs(container, point);
    }
  }
}

function centroidFromGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  const pairs = [];
  appendCoordinatePairs(pairs, geometry.coordinates);
  if (pairs.length === 0) {
    return null;
  }

  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of pairs) {
    sumLng += lng;
    sumLat += lat;
  }

  return [sumLat / pairs.length, sumLng / pairs.length];
}

function buildCountryCentroids(geoJson) {
  const lookup = new Map();
  const features = Array.isArray(geoJson?.features) ? geoJson.features : [];

  for (const feature of features) {
    const code = String(countryCodeFromFeature(feature) ?? "")
      .trim()
      .toUpperCase();
    if (!code) {
      continue;
    }

    const centroid = centroidFromGeometry(feature.geometry);
    if (!centroid) {
      continue;
    }

    lookup.set(code, centroid);
  }

  return lookup;
}

export function initializeMap(options = {}) {
  const {
    elementId = "world-map",
    onCountrySelect = () => {},
    onCountryClear = () => {}
  } = options;

  const mapElement = document.getElementById(elementId);
  if (!mapElement) {
    return {
      update() {},
      resize() {},
      setSelectedCountry() {},
      clearSelection() {},
      getSelectedCountry() {
        return null;
      }
    };
  }

  if (!window.L) {
    setMapPlaceholder(elementId, "Leaflet failed to load.");
    return {
      update() {},
      resize() {},
      setSelectedCountry() {},
      clearSelection() {},
      getSelectedCountry() {
        return null;
      }
    };
  }

  const map = L.map(elementId, {
    minZoom: 2,
    maxZoom: 8,
    worldCopyJump: true,
    zoomControl: true
  }).setView([20, 0], 2);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
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
  let lastArticles = [];
  let countryCentroids = new Map();

  function countryStyle(feature) {
    const code = countryCodeFromFeature(feature);
    const isSelected = selectedCountry && code === selectedCountry;
    return {
      color: isSelected ? "#0284c7" : "#64748b",
      weight: isSelected ? 1.5 : 0.8,
      fillColor: isSelected ? "#0ea5e9" : "#e2e8f0",
      fillOpacity: isSelected ? 0.45 : 0.2
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
        color: "#0f172a"
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

  function resolveMarkerPoint(geotag = {}) {
    const lat = Number.parseFloat(geotag.lat);
    const lng = Number.parseFloat(geotag.lng);
    if (isValidPoint(lat, lng)) {
      return [lat, lng];
    }

    const countryCode = String(geotag.country || "")
      .trim()
      .toUpperCase();
    if (!countryCode || countryCode === "UNK") {
      return null;
    }

    return countryCentroids.get(countryCode) ?? null;
  }

  async function loadWorldLayer() {
    try {
      const response = await fetch("assets/world.geo.json");
      if (!response.ok) {
        return;
      }

      const geoJson = await response.json();
      countryCentroids = buildCountryCentroids(geoJson);
      worldLayer = L.geoJSON(geoJson, {
        style: countryStyle,
        onEachFeature: bindCountryFeature
      });
      worldLayer.addTo(map);
      update(lastArticles);
    } catch (error) {
      console.warn("Failed to load world geojson", error);
    }
  }

  function update(articles) {
    lastArticles = Array.isArray(articles) ? articles : [];
    markers.clearLayers();

    const bounds = [];
    for (const article of lastArticles) {
      const geotag = article?.geotag || {};
      const country = String(geotag.country || "UNK").toUpperCase();
      const point = resolveMarkerPoint(geotag);

      if (!point || country === "UNK") {
        continue;
      }

      const [lat, lng] = point;
      const color = CATEGORY_COLORS[article.category] || "#64748b";
      const marker = L.circleMarker([lat, lng], {
        radius: 7,
        color,
        weight: 1.2,
        fillColor: color,
        fillOpacity: 0.85
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
    resize() {
      map.invalidateSize();
    },
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
