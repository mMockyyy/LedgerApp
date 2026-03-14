const BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8080";

interface RegisterResponse {
  id: string;
  email: string;
}

interface LoginResponse {
  token: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, init);

  const text = await response.text();
  const json = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} at ${path}: ${text}`);
  }

  return json as T;
}

async function main() {
  const randomSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `testuser_${randomSuffix}@example.com`;
  const password = "Passw0rd123!";

  console.log(`Using API: ${BASE_URL}`);
  console.log(`Creating user: ${email}`);

  const registered = await api<RegisterResponse>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const loggedIn = await api<LoginResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${loggedIn.token}`
  };

  const now = new Date();
  const month = now.toISOString().slice(0, 7);

  const expensePayloads = [
    {
      amount: 12.5,
      currency: "USD",
      category: "Food",
      merchant: "Cafe One",
      note: "Breakfast",
      incurredAt: now.toISOString()
    },
    {
      amount: 48.9,
      currency: "USD",
      category: "Transport",
      merchant: "Ride App",
      note: "Airport trip",
      incurredAt: new Date(now.getTime() - 86400000).toISOString()
    },
    {
      amount: 21.2,
      currency: "USD",
      category: "Groceries",
      merchant: "Market",
      note: "Weekly staples",
      incurredAt: new Date(now.getTime() - 2 * 86400000).toISOString()
    }
  ];

  for (const payload of expensePayloads) {
    await api("/expenses", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(payload)
    });
  }

  await api("/budgets", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      month,
      category: "Food",
      limit: 300
    })
  });

  const expenses = await api<unknown[]>(`/expenses?month=${month}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${loggedIn.token}` }
  });

  const insights = await api<{ month: string; total: number; byCategory: unknown[] }>(
    `/insights/monthly?month=${month}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${loggedIn.token}` }
    }
  );

  console.log("\nSeed complete.");
  console.log(`User ID: ${registered.id}`);
  console.log(`Token: ${loggedIn.token.slice(0, 24)}...`);
  console.log(`Expenses this month: ${expenses.length}`);
  console.log(`Insights total: ${insights.total}`);
}

main().catch((error) => {
  console.error("Failed to seed test data:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
