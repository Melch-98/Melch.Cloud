import { inngest } from './client';
import { shopifyFunctions } from './shopify-functions';
import { driveFunctions } from './drive-functions';

/**
 * Hello-world test function.
 * Trigger by sending a `test/hello` event from anywhere in the app:
 *
 *   import { inngest } from '@/lib/inngest/client';
 *   await inngest.send({ name: 'test/hello', data: { name: 'Melch' } });
 *
 * Or fire it manually from the Inngest dashboard → Functions → Invoke.
 */
export const helloWorld = inngest.createFunction(
  { id: 'hello-world', name: 'Hello World' },
  { event: 'test/hello' },
  async ({ event, step }) => {
    await step.run('log-greeting', async () => {
      console.log(`[inngest] Hello, ${event.data.name}!`);
    });

    return {
      message: `Hello, ${event.data.name}! Inngest is wired up.`,
      receivedAt: new Date().toISOString(),
    };
  }
);

// Add new functions to this array as we build them.
export const functions = [helloWorld, ...shopifyFunctions, ...driveFunctions];
