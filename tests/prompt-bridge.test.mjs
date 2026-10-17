import * as bridge from '../ui/prompt-bridge.js';
import { registerPromptBridgeContracts } from '../testing/prompt-bridge-contracts.mjs';

registerPromptBridgeContracts(bridge, () => import('../ui/prompt-bridge.js?independent-consumer=0.1'));
