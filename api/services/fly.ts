const BASE_URL = 'https://api.machines.dev/v1';

function getHeaders(): Record<string, string> {
  const token = process.env.FLY_API_TOKEN;
  if (!token) throw new Error('FLY_API_TOKEN env var is required');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function flyFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers as Record<string, string>) },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fly API ${options.method ?? 'GET'} ${path} failed (${res.status}): ${body}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function createApp(appName: string, org: string): Promise<any> {
  return flyFetch('/apps', {
    method: 'POST',
    body: JSON.stringify({ app_name: appName, org_slug: org }),
  });
}

export async function allocateIps(appName: string): Promise<void> {
  const token = process.env.FLY_API_TOKEN;
  if (!token) throw new Error('FLY_API_TOKEN env var is required');

  const graphql = async (query: string, variables: Record<string, unknown>) => {
    const res = await fetch('https://api.fly.io/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json();
    if (body.errors?.length) {
      throw new Error(`Fly GraphQL error: ${JSON.stringify(body.errors)}`);
    }
    return body.data;
  };

  const mutation = `
    mutation($input: AllocateIPAddressInput!) {
      allocateIpAddress(input: $input) {
        ipAddress { id address type }
      }
    }
  `;

  // Shared IPv4
  await graphql(mutation, { input: { appId: appName, type: 'shared_v4' } });
  // Dedicated IPv6
  await graphql(mutation, { input: { appId: appName, type: 'v6' } });
}

export async function createVolume(appName: string, region: string): Promise<any> {
  return flyFetch(`/apps/${appName}/volumes`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'openclaw_data',
      size_gb: 1,
      region,
    }),
  });
}

interface CreateMachineOptions {
  gatewayToken: string;
  volumeId: string;
  region: string;
}

async function resolveGatewayImage(): Promise<string> {
  const envImage = process.env.GATEWAY_IMAGE;
  if (envImage) return envImage;

  // Fetch the current image from the reference gateway app's running machine
  const refApp = process.env.GATEWAY_REF_APP ?? 'aware-gateway';
  try {
    const machines = await flyFetch(`/apps/${refApp}/machines`);
    if (Array.isArray(machines) && machines.length > 0 && machines[0].config?.image) {
      console.log(`[fly] Resolved gateway image from ${refApp}: ${machines[0].config.image}`);
      return machines[0].config.image;
    }
  } catch (err) {
    console.warn(`[fly] Failed to resolve image from ${refApp}, falling back to :latest`, err);
  }
  return 'registry.fly.io/aware-gateway:latest';
}

export async function createMachine(appName: string, options: CreateMachineOptions): Promise<any> {
  const image = await resolveGatewayImage();

  // Build the gateway config that gets written to /data/openclaw.json on first boot.
  // autoApproveDevices lets the Mac app connect without manual pairing approval.
  const gatewayConfig = JSON.stringify({
    gateway: {
      mode: 'local',
      port: 3000,
      bind: 'lan',
      autoApproveDevices: true,
      auth: {
        mode: 'token',
        token: options.gatewayToken,
      },
    },
  });

  // Escape single quotes for shell safety
  const escapedConfig = gatewayConfig.replace(/'/g, "'\\''");

  return flyFetch(`/apps/${appName}/machines`, {
    method: 'POST',
    body: JSON.stringify({
      region: options.region,
      config: {
        image,
        guest: {
          cpu_kind: 'shared',
          cpus: 2,
          memory_mb: 2048,
        },
        env: {
          OPENCLAW_GATEWAY_TOKEN: options.gatewayToken,
          OPENCLAW_STATE_DIR: '/data',
          NODE_ENV: 'production',
          ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
        },
        mounts: [
          {
            volume: options.volumeId,
            path: '/data',
          },
        ],
        services: [
          {
            internal_port: 3000,
            protocol: 'tcp',
            ports: [
              {
                port: 80,
                handlers: ['http'],
                force_https: true,
              },
              {
                port: 443,
                handlers: ['http', 'tls'],
              },
            ],
          },
        ],
        init: {
          cmd: [
            'bash',
            '-c',
            `[ -f /data/openclaw.json ] || echo '${escapedConfig}' > /data/openclaw.json; exec node dist/index.js gateway --port 3000 --bind lan`,
          ],
        },
      },
    }),
  });
}

export async function getMachine(appName: string, machineId: string): Promise<any> {
  return flyFetch(`/apps/${appName}/machines/${machineId}`);
}

export async function startMachine(appName: string, machineId: string): Promise<any> {
  return flyFetch(`/apps/${appName}/machines/${machineId}/start`, { method: 'POST' });
}

export async function stopMachine(appName: string, machineId: string): Promise<any> {
  return flyFetch(`/apps/${appName}/machines/${machineId}/stop`, { method: 'POST' });
}

export async function destroyMachine(appName: string, machineId: string): Promise<any> {
  return flyFetch(`/apps/${appName}/machines/${machineId}`, { method: 'DELETE' });
}

export async function destroyApp(appName: string): Promise<any> {
  return flyFetch(`/apps/${appName}`, { method: 'DELETE' });
}
