// Written by the deploy-evm workflow after each deploy (evm/scripts/deploy.js). v 2 = holds tokens too; v 3 = has the deposit brake; v 4 = staking (on where staking: true).
export const DEPLOYED = {
  "sepolia": {
    "address": "0xADfA45D7Fbf0896345c77C79585A334f37bbC254",
    "fromBlock": 12151100,
    "v": 3
  },
  "baseSepolia": {
    "address": "0x3e651897985A443c0d584c2a194FA6912a2AaAF6",
    "fromBlock": 59778609,
    "v": 3
  },
  "optimismSepolia": {
    "address": "0x82d2828DA942eE0ECEE70aC6BB1DcC8389760be2",
    "fromBlock": 51537529,
    "v": 3
  },
  "arbitrumSepolia": {
    "address": "0x82d2828DA942eE0ECEE70aC6BB1DcC8389760be2",
    "fromBlock": 329941635,
    "v": 3
  },
  "polygonAmoy": {
    "address": "0x82d2828DA942eE0ECEE70aC6BB1DcC8389760be2",
    "fromBlock": 53054982,
    "v": 3
  },
  "hoodi": {
    "address": "0x069dE522A8F2cB91677A3f74632b9c75D852844C",
    "fromBlock": 4036943,
    "v": 4,
    "staking": true,
    "args": [
      "0x3508A952176b3c15387C97BE809eaffB1982176a",
      "0x7E99eE3C66636DE415D2d7C880938F2f40f94De4",
      "0xfe56573178f1bcdf53F01A6E9977670dcBBD9186"
    ]
  },
  "base": {
    "address": "0x27D22cEAe73eb0c70E0157849C22F3E98f538bA2",
    "fromBlock": 59309646,
    "v": 4,
    "staking": false,
    "args": [
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000"
    ]
  },
  "optimism": {
    "address": "0x27D22cEAe73eb0c70E0157849C22F3E98f538bA2",
    "fromBlock": 159768805,
    "v": 4,
    "staking": false,
    "args": [
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000"
    ]
  },
  "polygon": {
    "address": "0x27D22cEAe73eb0c70E0157849C22F3E98f538bA2",
    "fromBlock": 97620793,
    "v": 4,
    "staking": false,
    "args": [
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000"
    ]
  },
  "bsc": {
    "address": "0x27D22cEAe73eb0c70E0157849C22F3E98f538bA2",
    "fromBlock": 134604388,
    "v": 4,
    "staking": false,
    "args": [
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000"
    ]
  },
  "ethereum": {
    "address": "0x27D22cEAe73eb0c70E0157849C22F3E98f538bA2",
    "fromBlock": 26452920,
    "v": 4,
    "staking": false,
    "args": [
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000"
    ]
  },
  "arbitrum": {
    "address": "0x27D22cEAe73eb0c70E0157849C22F3E98f538bA2",
    "fromBlock": 525779721,
    "v": 4,
    "staking": false,
    "args": [
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000"
    ]
  }
};
