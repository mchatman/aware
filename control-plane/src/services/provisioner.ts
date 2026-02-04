import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { gateways } from '../db/schema.js';
import { createApp, createVolume, createMachine } from './fly.js';

const FLY_ORG = process.env.FLY_ORG ?? 'ware-295';

export async function provisionGateway(
  userId: string,
  gatewayId: string,
  shortId: string,
  token: string,
  region: string,
): Promise<void> {
  const appName = `aw-${shortId}`;

  try {
    console.log(`[provisioner] Creating Fly app: ${appName}`);
    await createApp(appName, FLY_ORG);

    console.log(`[provisioner] Creating volume in ${appName} (region: ${region})`);
    const volume = await createVolume(appName, region);

    console.log(`[provisioner] Creating machine in ${appName}`);
    const machine = await createMachine(appName, {
      gatewayToken: token,
      volumeId: volume.id,
      region,
    });

    console.log(`[provisioner] Machine created: ${machine.id} — updating gateway status`);
    await db
      .update(gateways)
      .set({
        machineId: machine.id,
        status: 'running',
        updatedAt: new Date(),
      })
      .where(eq(gateways.id, gatewayId));

    console.log(`[provisioner] Gateway ${shortId} provisioned successfully`);
  } catch (err) {
    console.error(`[provisioner] Failed to provision gateway ${shortId}:`, err);
    await db
      .update(gateways)
      .set({
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(gateways.id, gatewayId));
  }
}
