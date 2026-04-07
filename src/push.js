import webpush from 'web-push';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getAllSubscriptions, deleteSubscription } from './db.js';

const VAPID_FILE = join(process.cwd(), 'data', 'vapid.json');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@sander.ninja';

let vapidKeys;

function getVapidKeys() {
  if (vapidKeys) return vapidKeys;

  if (existsSync(VAPID_FILE)) {
    vapidKeys = JSON.parse(readFileSync(VAPID_FILE, 'utf-8'));
  } else {
    vapidKeys = webpush.generateVAPIDKeys();
    mkdirSync(dirname(VAPID_FILE), { recursive: true });
    writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
  }

  webpush.setVapidDetails(VAPID_SUBJECT, vapidKeys.publicKey, vapidKeys.privateKey);
  return vapidKeys;
}

export function getPublicKey() {
  return getVapidKeys().publicKey;
}

export async function notifyAllExcept(excludeCode, payload) {
  getVapidKeys();
  const subs = getAllSubscriptions().filter(s => s.code !== excludeCode);
  const body = JSON.stringify(payload);

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, body);
    } catch (err) {
      // Clean up stale subscriptions
      if (err.statusCode === 404 || err.statusCode === 410) {
        deleteSubscription(s.endpoint);
      } else {
        console.error('Push failed:', err.statusCode, err.body);
      }
    }
  }));
}
