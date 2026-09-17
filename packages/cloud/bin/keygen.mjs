#!/usr/bin/env node
// Prints a new Ed25519 keypair. Put the private key in VENEER_SIGNING_KEY; add the public key to
// LICENSE_PUBLIC_KEYS in @veneer/core (newest first) and ship a client release before signing with it.
import { generateKeyPair } from '@veneer/core';
const kp = await generateKeyPair();
console.log('VENEER_SIGNING_KEY=' + kp.privateKey);
console.log('public key (add to @veneer/core LICENSE_PUBLIC_KEYS): ' + kp.publicKey);
