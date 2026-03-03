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

const BORDER_CONFLICT_PAIRS = [
  {
    id: "RUS-UKR",
    a: "RUS",
    b: "UKR",
    label: "Russia-Ukraine Front",
    keywords: ["donbas", "crimea", "dnipro", "kharkiv"]
  },
  {
    id: "ISR-PSE",
    a: "ISR",
    b: "PSE",
    label: "Israel-Gaza Border",
    keywords: ["gaza", "west bank", "hamas", "rafah"]
  },
  {
    id: "IND-PAK",
    a: "IND",
    b: "PAK",
    label: "India-Pakistan Border",
    keywords: ["kashmir", "line of control", "loc"]
  },
  {
    id: "IND-CHN",
    a: "IND",
    b: "CHN",
    label: "India-China Border",
    keywords: ["ladakh", "arunachal", "himalaya", "lac"]
  },
  {
    id: "AFG-PAK",
    a: "AFG",
    b: "PAK",
    label: "Afghanistan-Pakistan Border",
    keywords: ["durand line", "paktika", "nangarhar", "ttp"]
  },
  {
    id: "ARM-AZE",
    a: "ARM",
    b: "AZE",
    label: "Armenia-Azerbaijan Border",
    keywords: ["nagorno", "karabakh"]
  }
];

const COUNTRY_TEXT_MATCHERS = {
  USA: /\b(united states|u\.s\.|america|washington|new york)\b/i,
  IND: /\b(india|indian|new delhi|delhi|mumbai)\b/i,
  GBR: /\b(uk|britain|england|london|united kingdom)\b/i,
  CHN: /\b(china|chinese|beijing)\b/i,
  RUS: /\b(russia|russian|moscow)\b/i,
  UKR: /\b(ukraine|ukrainian|kyiv)\b/i,
  ISR: /\b(israel|israeli|jerusalem)\b/i,
  PSE: /\b(gaza|palestine|palestinian|west bank)\b/i,
  PAK: /\b(pakistan|pakistani|islamabad|lahore)\b/i,
  AFG: /\b(afghanistan|afghan|kabul)\b/i,
  ARM: /\b(armenia|armenian|yerevan)\b/i,
  AZE: /\b(azerbaijan|azerbaijani|baku)\b/i
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

function getTensionClass(score) {
  if (score >= 7) return "tension-high";
  if (score >= 4) return "tension-med";
  return "tension-low";
}

function hasConflictSignal(article) {
  if (article?.signals?.conflict || (article?.intelligence?.tensionScore >= 7)) {
    return true;
  }
  const tags = Array.isArray(article?.tags) ? article.tags : [];
  return tags.some((tag) => /\b(conflict|war|ceasefire|military|attack)\b/i.test(tag));
}

function articleSearchText(article) {
  const tags = Array.isArray(article?.tags) ? article.tags.join(" ") : "";
  return `${article?.title || ""} ${article?.excerpt || ""} ${tags}`.toLowerCase();
}

function detectMentionedCountries(article) {
  const text = articleSearchText(article);
  const mentioned = new Set();

  for (const [country, pattern] of Object.entries(COUNTRY_TEXT_MATCHERS)) {
    if (pattern.test(text)) {
      mentioned.add(country);
    }
  }

  const geotagCountry = String(article?.geotag?.country || "")
    .trim()
    .toUpperCase();
  if (geotagCountry && geotagCountry !== "UNK") {
    mentioned.add(geotagCountry);
  }

  return mentioned;
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

function buildBorderConflictSignals(articles) {
  const signals = new Map();

  for (const article of articles) {
    const priority = normalizePriority(article?.priority);
    const conflict = hasConflictSignal(article);
    if (!conflict && priority !== "High") {
      continue;
    }

    const text = articleSearchText(article);
    const countries = detectMentionedCountries(article);

    for (const pair of BORDER_CONFLICT_PAIRS) {
      const hasA = countries.has(pair.a);
      const hasB = countries.has(pair.b);
      const keywordHit = pair.keywords.some((keyword) => text.includes(keyword.toLowerCase()));

      if (!((hasA && hasB) || (keywordHit && (hasA || hasB)))) {
        continue;
      }

      const existing = signals.get(pair.id) || {
        ...pair,
        count: 0,
        priority: "Low",
        sampleTitle: ""
      };

      existing.count += 1;
      if (PRIORITY_RANK[priority] > PRIORITY_RANK[existing.priority]) {
        existing.priority = priority;
        existing.sampleTitle = article.title || existing.sampleTitle;
      }

      signals.set(pair.id, existing);
    }
  }

  return Array.from(signals.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  });
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
  const borderOverlays = L.layerGroup().addTo(map);

  let selectedCountry = null;
  let worldLayer = null;
  let lastArticles = [];
  let countryCentroids = new Map();
  let countrySignals = new Map();

  const legendControl = L.control({ position: "bottomleft" });
  legendControl.onAdd = () => {
    const container = L.DomUtil.create("div", "map-legend");
    container.innerHTML = `
      <div class="legend-row"><span class="legend-dot" style="background:#ef4444"></span>High priority country</div>
      <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span>Medium priority country</div>
      <div class="legend-row"><span class="legend-dot" style="background:#22c55e"></span>Low priority country</div>
      <div class="legend-row"><span class="legend-line"></span>Border conflict corridor</div>
    `;
    return container;
  };
  legendControl.addTo(map);

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
    const borderSignals = buildBorderConflictSignals(lastArticles);
    refreshWorldStyles();
    markers.clearLayers();
    borderOverlays.clearLayers();

    const bounds = [];
    const narrativeClusters = new Map();

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
      
      const intel = article.intelligence || {};
      const tension = intel.tensionScore || 0;
      const cluster = intel.narrativeCluster || "General";

      if (cluster !== "General") {
        const existing = narrativeClusters.get(cluster) || [];
        existing.push(point);
        narrativeClusters.set(cluster, existing);
      }

      const tensionClass = getTensionClass(tension);
      const markerHtml = `
        <div class="custom-intel-marker ${tensionClass}" style="position: relative; width: 12px; height: 12px;">
          <div style="background: ${color}; width: 100%; height: 100%; border-radius: 50%; border: 1px solid white;"></div>
          ${tension >= 7 ? '<div class="tension-pulse"></div>' : ""}
        </div>
      `;

      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          html: markerHtml,
          className: "intel-marker-container",
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        })
      });

      const popupContent = `
        <div style="min-width: 200px;">
          <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; margin-bottom: 2px;">Intelligence Report</div>
          <strong style="display: block; margin-bottom: 5px; font-size: 0.9rem;">${escapeHtml(article.title)}</strong>
          <div style="font-size: 0.75rem; margin-bottom: 8px; color: #cbd5e1;">Source: ${escapeHtml(article.sourceName)}</div>
          
          <div class="reader-intel" style="padding: 8px; margin-bottom: 0; background: #0f172a; border-radius: 6px; border: 1px solid #334155;">
            <div class="intel-item" style="margin-bottom: 6px;">
              <span class="intel-label" style="font-size: 0.6rem;">Geopolitical Tension</span>
              <div class="tension-bar-container" style="height: 4px; background: #1e293b; border-radius: 2px; overflow: hidden; margin: 2px 0;">
                <div class="tension-bar-fill tension-bg-${tension >= 7 ? "high" : tension >= 4 ? "med" : "low"}" style="width: ${tension * 10}%; height: 100%;"></div>
              </div>
              <span style="font-size: 0.65rem; color: #94a3b8;">Score: ${tension}/10</span>
            </div>
            ${cluster ? `<div class="intel-item"><span class="intel-label" style="font-size: 0.6rem;">Narrative</span><span class="intel-value" style="font-size: 0.7rem; color: #c4b5fd;">${escapeHtml(cluster)}</span></div>` : ""}
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);

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

    // Visualize Narrative Clusters
    for (const [name, points] of narrativeClusters.entries()) {
      if (points.length < 2) continue;
      
      const line = L.polyline(points, {
        color: "#7c3aed",
        weight: 1,
        dashArray: "4 4",
        opacity: 0.3
      }).addTo(borderOverlays);
      
      line.bindTooltip(`Narrative: ${escapeHtml(name)}`, { sticky: true });
    }

    for (const signal of borderSignals) {
      const start = countryCentroids.get(signal.a);
      const end = countryCentroids.get(signal.b);
      if (!start || !end) {
        continue;
      }

      const lineColor = signal.priority === "High" ? "#b91c1c" : "#dc2626";
      const lineWeight = 2 + Math.min(4, signal.count * 0.6);
      const line = L.polyline([start, end], {
        color: lineColor,
        weight: lineWeight,
        opacity: 0.78,
        dashArray: "8 6"
      });

      line.bindTooltip(`${escapeHtml(signal.label)} • ${signal.count} signals`, {
        sticky: true
      });
      line.bindPopup(
        [
          `<strong>${escapeHtml(signal.label)}</strong>`,
          `<div>Signals: ${escapeHtml(signal.count)}</div>`,
          `<div>Priority: ${escapeHtml(signal.priority)}</div>`,
          signal.sampleTitle ? `<div>Example: ${escapeHtml(signal.sampleTitle)}</div>` : ""
        ].join("")
      );

      borderOverlays.addLayer(line);

      bounds.push(start);
      bounds.push(end);
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
