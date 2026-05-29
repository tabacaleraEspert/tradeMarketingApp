/**
 * Stress test con k6 — simula 40 usuarios de campo usando la app.
 *
 * Instalar k6:
 *   brew install k6
 *
 * Ejecutar contra producción:
 *   k6 run scripts/stress-test.js
 *
 * Ejecutar contra local:
 *   k6 run -e BASE_URL=http://localhost:8000 scripts/stress-test.js
 *
 * Solo el flujo de login + dashboard (sin crear datos):
 *   k6 run -e READ_ONLY=true scripts/stress-test.js
 *
 * El test simula el flujo real de un día de trabajo:
 *   1. Login (todos a las 8am)
 *   2. Cargar dashboard/ruta del día
 *   3. Listar PDVs
 *   4. Por cada visita: check-in → acciones → check-out → completar
 *   5. Refresh de token periódico
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

// ============================================================================
// Config
// ============================================================================
const BASE_URL = __ENV.BASE_URL || "https://espert-trade-api.azurewebsites.net";
const READ_ONLY = __ENV.READ_ONLY === "true";
const TODAY = new Date().toISOString().slice(0, 10);

// Credenciales de test — usa un usuario real o crea usuarios de prueba
// Podés pasar credenciales: k6 run -e TEST_EMAIL=user@test.com -e TEST_PASS=pass123 ...
const TEST_EMAIL = __ENV.TEST_EMAIL || "test@espert.com";
const TEST_PASS = __ENV.TEST_PASS || "TestPass123!";

// ============================================================================
// Métricas custom
// ============================================================================
const loginSuccess = new Rate("login_success");
const dashboardDuration = new Trend("dashboard_duration", true);
const visitCreateDuration = new Trend("visit_create_duration", true);
const photoUploadDuration = new Trend("photo_upload_duration", true);

// ============================================================================
// Escenarios de carga
// ============================================================================
export const options = {
  scenarios: {
    // Fase 1: Ramp-up — simula que los usuarios van abriendo la app
    morning_start: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },  // primeros 10 usuarios
        { duration: "30s", target: 25 },  // sigue creciendo
        { duration: "30s", target: 40 },  // todos los 40 conectados
        { duration: "2m", target: 40 },   // mantener carga 2 min (el core del test)
        { duration: "30s", target: 0 },   // ramp-down
      ],
    },

    // Fase 2: Spike — todos cargan el dashboard al mismo tiempo (8am)
    morning_spike: {
      executor: "shared-iterations",
      vus: 40,
      iterations: 40,
      maxDuration: "30s",
      startTime: "4m",  // arranca después del ramp-up
    },
  },

  thresholds: {
    // P95 de response time < 2 segundos
    http_req_duration: ["p(95)<2000"],
    // Menos de 5% de requests fallidos
    http_req_failed: ["rate<0.05"],
    // Login siempre debe funcionar
    login_success: ["rate>0.95"],
    // Dashboard < 1.5s en p95
    dashboard_duration: ["p(95)<1500"],
  },
};

// ============================================================================
// Headers helper
// ============================================================================
function authHeaders(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
}

// ============================================================================
// Flujo principal — cada VU ejecuta esto en loop
// ============================================================================
export default function () {
  let token = null;

  // ── Login ──────────────────────────────────────────────────────────────
  group("01_login", function () {
    const res = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
      { headers: { "Content-Type": "application/json" } }
    );

    const success = check(res, {
      "login status 200": (r) => r.status === 200,
      "has access_token": (r) => {
        try { return JSON.parse(r.body).access_token !== undefined; }
        catch { return false; }
      },
    });

    loginSuccess.add(success ? 1 : 0);

    if (success) {
      const data = JSON.parse(res.body);
      token = data.access_token;
    }
  });

  if (!token) {
    console.warn("Login failed, skipping rest of flow");
    sleep(2);
    return;
  }

  sleep(1); // pausa natural después del login

  // ── Dashboard (ruta del día) ───────────────────────────────────────────
  let routeDayPdvs = [];
  group("02_dashboard", function () {
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/dashboard/home?date=${TODAY}`,
      authHeaders(token)
    );
    dashboardDuration.add(Date.now() - start);

    check(res, {
      "dashboard status 200": (r) => r.status === 200,
    });

    if (res.status === 200) {
      try {
        const data = JSON.parse(res.body);
        routeDayPdvs = data.route_day_pdvs || data.pdvs || [];
      } catch { /* noop */ }
    }
  });

  sleep(0.5);

  // ── Listar PDVs ────────────────────────────────────────────────────────
  group("03_list_pdvs", function () {
    const res = http.get(
      `${BASE_URL}/pdvs?limit=100`,
      authHeaders(token)
    );
    check(res, {
      "pdvs status 200": (r) => r.status === 200,
    });
  });

  sleep(0.5);

  // ── Health check ───────────────────────────────────────────────────────
  group("04_health", function () {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      "health status 200": (r) => r.status === 200,
    });
  });

  if (READ_ONLY) {
    sleep(2);
    return;
  }

  // ── Flujo de visita (solo si hay PDVs asignados) ───────────────────────
  if (routeDayPdvs.length > 0) {
    const pdv = routeDayPdvs[0];
    const pdvId = pdv.PdvId || pdv.pdv_id;

    if (pdvId) {
      group("05_visit_flow", function () {
        // Crear visita (check-in)
        const start = Date.now();
        const createRes = http.post(
          `${BASE_URL}/visits`,
          JSON.stringify({
            PdvId: pdvId,
            Status: "OPEN",
          }),
          authHeaders(token)
        );
        visitCreateDuration.add(Date.now() - start);

        const created = check(createRes, {
          "visit created": (r) => r.status === 200 || r.status === 201,
        });

        if (!created) return;

        let visitId;
        try {
          visitId = JSON.parse(createRes.body).VisitId;
        } catch { return; }

        sleep(0.3);

        // Check-in GPS
        http.post(
          `${BASE_URL}/visits/${visitId}/checks`,
          JSON.stringify({
            CheckType: "IN",
            Lat: -34.6037 + Math.random() * 0.01,
            Lon: -58.3816 + Math.random() * 0.01,
            AccuracyMeters: 10,
            DistanceToPdvM: 25,
          }),
          authHeaders(token)
        );

        sleep(1); // simula tiempo trabajando en el PDV

        // Listar acciones de la visita
        http.get(
          `${BASE_URL}/visits/${visitId}/actions`,
          authHeaders(token)
        );

        sleep(0.5);

        // Obtener visita completa
        http.get(
          `${BASE_URL}/visits/${visitId}/full`,
          authHeaders(token)
        );

        sleep(0.5);

        // Check-out
        http.post(
          `${BASE_URL}/visits/${visitId}/checks`,
          JSON.stringify({
            CheckType: "OUT",
            Lat: -34.6037 + Math.random() * 0.01,
            Lon: -58.3816 + Math.random() * 0.01,
            AccuracyMeters: 10,
            DistanceToPdvM: 25,
          }),
          authHeaders(token)
        );

        sleep(0.3);

        // Completar visita
        http.patch(
          `${BASE_URL}/visits/${visitId}`,
          JSON.stringify({
            Status: "COMPLETED",
          }),
          authHeaders(token)
        );
      });
    }
  }

  // ── Token refresh ──────────────────────────────────────────────────────
  group("06_token_refresh", function () {
    // Simulamos que el token se refresca periódicamente
    // En el test real no tenemos el refresh_token, así que solo probamos
    // que el endpoint responde (aunque falle por token inválido, mide latencia)
    http.post(
      `${BASE_URL}/auth/refresh`,
      JSON.stringify({ refresh_token: "test-refresh-token" }),
      { headers: { "Content-Type": "application/json" } }
    );
  });

  sleep(2); // pausa entre iteraciones del VU
}

// ============================================================================
// Spike scenario — 40 usuarios cargan dashboard simultáneamente
// ============================================================================
export function morning_spike() {
  // Login rápido
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (loginRes.status !== 200) return;

  const token = JSON.parse(loginRes.body).access_token;

  // TODOS cargan el dashboard al mismo tiempo
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/dashboard/home?date=${TODAY}`,
    authHeaders(token)
  );
  dashboardDuration.add(Date.now() - start);

  check(res, {
    "spike: dashboard status 200": (r) => r.status === 200,
    "spike: dashboard < 2s": (r) => r.timings.duration < 2000,
  });
}
