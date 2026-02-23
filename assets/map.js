const PRIORITY_RANK = {
  High: 3,
  Medium: 2,
  Low: 1,
  None: 0
};

const PRIORITY_COLORS = {
  High: "#ef4444",
  Medium: "#f59e0b",
  Low: "#22c55e",
  None: "#334155"
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

function normalizePriority(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["high", "critical", "urgent"].includes(normalized)) {
    return "High";
  }
  if (["medium", "moderate"].includes(normalized)) {
    return "Medium";
  }
  if (["low", "minor", "routine"].includes(normalized)) {
    return "Low";
  }
  return "Low";
}

function hasConflictSignal(article) {
  if (article?.signals?.conflict) {
    return true;
  }
  const tags = Array.isArray(article?.tags) ? article.tags : [];
  return tags.some((tag) => /\b(conflict|war|ceasefire|military|attack)\b/i.test(tag));
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

function buildCountrySignals(articles) {
  const lookup = new Map();

  for (const article of articles) {
    const country = String(article?.geotag?.country || "")
      .trim()
      .toUpperCase();
    if (!country || country === "UNK") {
      continue;
    }

    const priority = normalizePriority(article?.priority);
    const conflict = hasConflictSignal(article);
    const existing = lookup.get(country) || {
      priority: "Low",
      conflict: false,
      count: 0
    };

    if (PRIORITY_RANK[priority] > PRIORITY_RANK[existing.priority]) {
      existing.priority = priority;
    }
    existing.conflict = existing.conflict || conflict;
    existing.count += 1;
    lookup.set(country, existing);
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
  let countrySignals = new Map();

  function countryStyle(feature) {
    const code = String(countryCodeFromFeature(feature) ?? "")
      .trim()
      .toUpperCase();
    const signal = countrySignals.get(code);
    const isSelected = Boolean(selectedCountry && code === selectedCountry);
    const priority = signal?.priority || "None";
    const fillColor = PRIORITY_COLORS[priority] || PRIORITY_COLORS.None;
    const conflict = Boolean(signal?.conflict);

    return {
      color: isSelected ? "#0c4a6e" : conflict ? "#7f1d1d" : "#475569",
      weight: isSelected ? 1.8 : conflict ? 1.4 : 0.8,
      fillColor: isSelected ? "#0ea5e9" : fillColor,
      fillOpacity: isSelected ? 0.5 : signal ? 0.28 : 0.12
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
        weight: 1.5,
        color: "#0f172a"
      });
    });

    layer.on("mouseout", () => {
      refreshWorldStyles();
    });

    layer.on("click", (event) => {
      if (event) {
        L.DomEvent.stopPropagation(event);
      }

      const code = String(countryCodeFromFeature(feature) ?? "")
        .trim()
        .toUpperCase();
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
    countrySignals = buildCountrySignals(lastArticles);
    refreshWorldStyles();
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
      const priority = normalizePriority(article?.priority);
      const conflict = hasConflictSignal(article);
      const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.Low;

      const marker = L.circleMarker([lat, lng], {
        radius: conflict ? 8 : 7,
        color: conflict ? "#7f1d1d" : color,
        weight: conflict ? 1.8 : 1.2,
        fillColor: color,
        fillOpacity: 0.86
      });

      marker.bindPopup(
        [
          `<strong>${escapeHtml(article.title)}</strong>`,
          `<div>${escapeHtml(article.sourceName)}</div>`,
          `<div>Country: ${escapeHtml(country)}</div>`,
          `<div>Priority: ${escapeHtml(priority)}</div>`,
          `<div>Conflict Signal: ${conflict ? "Yes" : "No"}</div>`
        ].join("")
      );

      marker.on("click", (event) => {
        if (event?.originalEvent) {
          L.DomEvent.stopPropagation(event.originalEvent);
        }

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

  map.on("click", () => {
    if (selectedCountry) {
      setSelectedCountry(null, true);
    }
  });

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
