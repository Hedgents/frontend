/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/scarcity_exchange.json`.
 */
export type ScarcityExchange = {
  "address": "CJHWP9ed1BzWVQhUeJPQ9jJb4YcVWiFNpQcG7mPEGk86",
  "metadata": {
    "name": "scarcityExchange",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Fully collateralized binary and scalar curve markets for Hedgents."
  },
  "instructions": [
    {
      "name": "addCurveStake",
      "discriminator": [
        60,
        137,
        137,
        222,
        43,
        148,
        233,
        12
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "curveMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curve_market.market_id",
                "account": "curveMarket"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "collateralMint",
          "relations": [
            "config",
            "curveMarket"
          ]
        },
        {
          "name": "ownerCollateral",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "curveVault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancelOrder",
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "market",
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.maker",
                "account": "limitOrder"
              },
              {
                "kind": "account",
                "path": "order.order_id",
                "account": "limitOrder"
              }
            ]
          }
        },
        {
          "name": "maker",
          "writable": true,
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "escrowMint",
          "relations": [
            "order"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "makerRefund",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "claimCurvePosition",
      "discriminator": [
        219,
        245,
        243,
        159,
        91,
        249,
        29,
        194
      ],
      "accounts": [
        {
          "name": "curveMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curve_market.market_id",
                "account": "curveMarket"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "collateralMint",
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "ownerCollateral",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "curveVault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closeMarket",
      "docs": [
        "Reclaim the rent of a settled market whose vault owes nothing.",
        "",
        "A market account is permanent otherwise, which at one round every fifteen minutes is the",
        "dominant running cost of the price market. Closing recovers the market account and its",
        "vault; the two outcome mints cannot be closed by the SPL token program and stay behind.",
        "",
        "The guard is that the vault has no remaining liability. `redeem` is bounded by",
        "`total_redeemed <= open_interest`, so once those are equal nobody can redeem anything ever",
        "again and the vault balance is dust-free by construction; both are checked rather than",
        "inferred. A winner who has not redeemed yet keeps the market open, which is the point:",
        "nothing here may strand a claim to reclaim rent."
      ],
      "discriminator": [
        88,
        154,
        248,
        186,
        48,
        14,
        123,
        244
      ],
      "accounts": [
        {
          "name": "config",
          "relations": [
            "market"
          ]
        },
        {
          "name": "admin",
          "docs": [
            "Receives the reclaimed rent, and is the only party allowed to reclaim it."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "scarcityMarket"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createCurveMarket",
      "discriminator": [
        238,
        254,
        248,
        91,
        224,
        37,
        37,
        123
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "collateralMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "feeRecipient",
          "relations": [
            "config"
          ]
        },
        {
          "name": "curveMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "curveVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curveMarket"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "metricHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "rulesHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "opensAt",
          "type": "i64"
        },
        {
          "name": "closesAt",
          "type": "i64"
        },
        {
          "name": "resolveAfter",
          "type": "i64"
        },
        {
          "name": "bucketCount",
          "type": "u8"
        },
        {
          "name": "jackpotBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "createMarket",
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "collateralMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "noMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "questionHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "rulesHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "opensAt",
          "type": "i64"
        },
        {
          "name": "closesAt",
          "type": "i64"
        },
        {
          "name": "resolveAfter",
          "type": "i64"
        }
      ]
    },
    {
      "name": "fillAsk",
      "discriminator": [
        108,
        124,
        175,
        52,
        120,
        217,
        106,
        221
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "scarcityMarket"
              }
            ]
          },
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.maker",
                "account": "limitOrder"
              },
              {
                "kind": "account",
                "path": "order.order_id",
                "account": "limitOrder"
              }
            ]
          }
        },
        {
          "name": "taker",
          "writable": true,
          "signer": true
        },
        {
          "name": "collateralMint",
          "relations": [
            "market",
            "order"
          ]
        },
        {
          "name": "outcomeMint",
          "relations": [
            "order"
          ]
        },
        {
          "name": "makerCollateral",
          "writable": true
        },
        {
          "name": "takerCollateral",
          "writable": true
        },
        {
          "name": "takerOutcome",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "feeRecipient",
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "quantity",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fillBid",
      "discriminator": [
        246,
        88,
        106,
        75,
        0,
        9,
        167,
        159
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "scarcityMarket"
              }
            ]
          },
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.maker",
                "account": "limitOrder"
              },
              {
                "kind": "account",
                "path": "order.order_id",
                "account": "limitOrder"
              }
            ]
          }
        },
        {
          "name": "taker",
          "writable": true,
          "signer": true
        },
        {
          "name": "collateralMint",
          "relations": [
            "market",
            "order"
          ]
        },
        {
          "name": "outcomeMint",
          "relations": [
            "order"
          ]
        },
        {
          "name": "makerOutcome",
          "writable": true
        },
        {
          "name": "takerCollateral",
          "writable": true
        },
        {
          "name": "takerOutcome",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "feeRecipient",
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "quantity",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "program",
          "address": "CJHWP9ed1BzWVQhUeJPQ9jJb4YcVWiFNpQcG7mPEGk86"
        },
        {
          "name": "programData"
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "feeRecipient"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "resolver",
          "type": "pubkey"
        },
        {
          "name": "tradingFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "invalidateCurveMarket",
      "discriminator": [
        20,
        86,
        73,
        118,
        78,
        232,
        255,
        234
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "resolver",
          "signer": true,
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "curveMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curve_market.market_id",
                "account": "curveMarket"
              }
            ]
          }
        },
        {
          "name": "curveVault"
        }
      ],
      "args": [
        {
          "name": "resolutionReportHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "mergeCompleteSet",
      "discriminator": [
        245,
        171,
        74,
        49,
        59,
        192,
        150,
        216
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "scarcityMarket"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "collateralMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "ownerCollateral",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "noMint",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "ownerYes",
          "writable": true
        },
        {
          "name": "ownerNo",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintCompleteSet",
      "discriminator": [
        70,
        222,
        130,
        148,
        234,
        103,
        137,
        61
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "scarcityMarket"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "collateralMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "ownerCollateral",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "noMint",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "ownerYes",
          "writable": true
        },
        {
          "name": "ownerNo",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openCurvePosition",
      "discriminator": [
        233,
        133,
        135,
        237,
        97,
        246,
        9,
        90
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "curveMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curve_market.market_id",
                "account": "curveMarket"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "collateralMint",
          "relations": [
            "config",
            "curveMarket"
          ]
        },
        {
          "name": "ownerCollateral",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "curveVault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bucket",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "placeOrder",
      "discriminator": [
        51,
        194,
        155,
        175,
        109,
        130,
        96,
        106
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "scarcityMarket"
              }
            ]
          }
        },
        {
          "name": "maker",
          "writable": true,
          "signer": true
        },
        {
          "name": "collateralMint",
          "relations": [
            "config",
            "market"
          ]
        },
        {
          "name": "outcomeMint"
        },
        {
          "name": "feeRecipient",
          "relations": [
            "config"
          ]
        },
        {
          "name": "makerSource",
          "writable": true
        },
        {
          "name": "escrowMint"
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "maker"
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "orderVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "order"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "orderSide"
            }
          }
        },
        {
          "name": "priceMicroUsdc",
          "type": "u64"
        },
        {
          "name": "quantity",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "recoverCurveMarket",
      "discriminator": [
        136,
        66,
        80,
        213,
        86,
        239,
        117,
        114
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "curveMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curve_market.market_id",
                "account": "curveMarket"
              }
            ]
          }
        },
        {
          "name": "curveVault"
        }
      ],
      "args": [
        {
          "name": "resolutionReportHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "redeem",
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "scarcityMarket"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "collateralMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "ownerCollateral",
          "writable": true
        },
        {
          "name": "claimMint",
          "writable": true
        },
        {
          "name": "ownerClaim",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "resolveCurveMarket",
      "discriminator": [
        153,
        12,
        248,
        17,
        189,
        156,
        91,
        243
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "resolver",
          "signer": true,
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "curveMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curve_market.market_id",
                "account": "curveMarket"
              }
            ]
          }
        },
        {
          "name": "collateralMint",
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "curveVault",
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true,
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "normalizedOutcome",
          "type": "i32"
        },
        {
          "name": "resolutionReportHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "resolveMarket",
      "discriminator": [
        155,
        23,
        80,
        173,
        46,
        74,
        23,
        239
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "resolver",
          "signer": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "scarcityMarket"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": {
            "defined": {
              "name": "resolutionOutcome"
            }
          }
        },
        {
          "name": "resolutionReportHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setResolver",
      "discriminator": [
        137,
        108,
        27,
        51,
        202,
        16,
        33,
        119
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "resolver",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdrawCurveStake",
      "discriminator": [
        194,
        59,
        102,
        26,
        195,
        80,
        107,
        4
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "curveMarket"
          ]
        },
        {
          "name": "curveMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curve_market.market_id",
                "account": "curveMarket"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "collateralMint",
          "relations": [
            "config",
            "curveMarket"
          ]
        },
        {
          "name": "ownerCollateral",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "curveVault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "curveMarket",
      "discriminator": [
        45,
        10,
        51,
        11,
        117,
        71,
        80,
        11
      ]
    },
    {
      "name": "curvePosition",
      "discriminator": [
        36,
        133,
        229,
        181,
        19,
        209,
        230,
        139
      ]
    },
    {
      "name": "exchangeConfig",
      "discriminator": [
        95,
        245,
        246,
        58,
        98,
        226,
        105,
        131
      ]
    },
    {
      "name": "limitOrder",
      "discriminator": [
        137,
        183,
        212,
        91,
        115,
        29,
        141,
        227
      ]
    },
    {
      "name": "scarcityMarket",
      "discriminator": [
        242,
        115,
        86,
        189,
        80,
        131,
        143,
        135
      ]
    }
  ],
  "events": [
    {
      "name": "completeSetMerged",
      "discriminator": [
        191,
        93,
        106,
        227,
        82,
        141,
        252,
        156
      ]
    },
    {
      "name": "completeSetMinted",
      "discriminator": [
        138,
        100,
        135,
        145,
        242,
        178,
        224,
        155
      ]
    },
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "curveMarketCreated",
      "discriminator": [
        29,
        222,
        158,
        31,
        53,
        205,
        159,
        161
      ]
    },
    {
      "name": "curveMarketInvalidated",
      "discriminator": [
        184,
        131,
        177,
        108,
        106,
        49,
        212,
        185
      ]
    },
    {
      "name": "curveMarketRecovered",
      "discriminator": [
        138,
        68,
        128,
        233,
        56,
        79,
        26,
        137
      ]
    },
    {
      "name": "curveMarketResolved",
      "discriminator": [
        189,
        226,
        189,
        216,
        84,
        56,
        196,
        35
      ]
    },
    {
      "name": "curvePositionClaimed",
      "discriminator": [
        128,
        26,
        131,
        69,
        163,
        23,
        68,
        120
      ]
    },
    {
      "name": "curvePositionOpened",
      "discriminator": [
        90,
        157,
        251,
        87,
        62,
        214,
        173,
        226
      ]
    },
    {
      "name": "curveStakeAdded",
      "discriminator": [
        78,
        126,
        219,
        171,
        78,
        72,
        247,
        151
      ]
    },
    {
      "name": "curveStakeWithdrawn",
      "discriminator": [
        5,
        252,
        164,
        69,
        248,
        102,
        243,
        73
      ]
    },
    {
      "name": "marketClosed",
      "discriminator": [
        86,
        91,
        119,
        43,
        94,
        0,
        217,
        113
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketResolved",
      "discriminator": [
        89,
        67,
        230,
        95,
        143,
        106,
        199,
        202
      ]
    },
    {
      "name": "orderCancelled",
      "discriminator": [
        108,
        56,
        128,
        68,
        168,
        113,
        168,
        239
      ]
    },
    {
      "name": "orderFilled",
      "discriminator": [
        120,
        124,
        109,
        66,
        249,
        116,
        174,
        30
      ]
    },
    {
      "name": "orderPlaced",
      "discriminator": [
        96,
        130,
        204,
        234,
        169,
        219,
        216,
        227
      ]
    },
    {
      "name": "pauseChanged",
      "discriminator": [
        238,
        188,
        213,
        78,
        134,
        209,
        178,
        218
      ]
    },
    {
      "name": "positionRedeemed",
      "discriminator": [
        129,
        143,
        180,
        44,
        111,
        214,
        220,
        176
      ]
    },
    {
      "name": "resolverChanged",
      "discriminator": [
        6,
        235,
        225,
        252,
        79,
        239,
        195,
        145
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Only the configured authority may perform this action."
    },
    {
      "code": 6001,
      "name": "invalidResolver",
      "msg": "The resolver public key is invalid."
    },
    {
      "code": 6002,
      "name": "issuancePaused",
      "msg": "New issuance is paused."
    },
    {
      "code": 6003,
      "name": "invalidMarketId",
      "msg": "The market identifier is invalid."
    },
    {
      "code": 6004,
      "name": "invalidCommitment",
      "msg": "A required content commitment is invalid."
    },
    {
      "code": 6005,
      "name": "invalidSchedule",
      "msg": "The market schedule is invalid."
    },
    {
      "code": 6006,
      "name": "invalidAmount",
      "msg": "The amount must be greater than zero."
    },
    {
      "code": 6007,
      "name": "marketNotOpen",
      "msg": "The market is not open yet."
    },
    {
      "code": 6008,
      "name": "marketClosed",
      "msg": "The market is closed to new issuance."
    },
    {
      "code": 6009,
      "name": "marketResolved",
      "msg": "The market has already been resolved."
    },
    {
      "code": 6010,
      "name": "marketNotResolved",
      "msg": "The market has not been resolved."
    },
    {
      "code": 6011,
      "name": "resolutionTooEarly",
      "msg": "The market cannot be resolved yet."
    },
    {
      "code": 6012,
      "name": "wrongCollateralMint",
      "msg": "The supplied collateral mint is not accepted."
    },
    {
      "code": 6013,
      "name": "invalidCollateralDecimals",
      "msg": "The collateral mint must use six decimal places."
    },
    {
      "code": 6014,
      "name": "wrongOutcomeMint",
      "msg": "The supplied outcome mint does not belong to this market."
    },
    {
      "code": 6015,
      "name": "losingOutcome",
      "msg": "The supplied outcome did not win this market."
    },
    {
      "code": 6016,
      "name": "amountExceedsLiability",
      "msg": "The amount exceeds the market's remaining collateral liability."
    },
    {
      "code": 6017,
      "name": "amountTooSmall",
      "msg": "The amount is too small to produce a payout."
    },
    {
      "code": 6018,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow or underflow."
    },
    {
      "code": 6019,
      "name": "feeTooHigh",
      "msg": "The configured trading fee exceeds the protocol maximum."
    },
    {
      "code": 6020,
      "name": "invalidOrderId",
      "msg": "The order identifier is invalid."
    },
    {
      "code": 6021,
      "name": "invalidPrice",
      "msg": "The outcome price must be greater than zero and no more than one USDC."
    },
    {
      "code": 6022,
      "name": "orderExpired",
      "msg": "The order has expired."
    },
    {
      "code": 6023,
      "name": "wrongEscrowMint",
      "msg": "The escrow mint does not match the order side."
    },
    {
      "code": 6024,
      "name": "wrongFeeRecipient",
      "msg": "The fee recipient does not match the snapshotted order configuration."
    },
    {
      "code": 6025,
      "name": "wrongOrderSide",
      "msg": "The order side does not match this fill instruction."
    },
    {
      "code": 6026,
      "name": "amountExceedsOrder",
      "msg": "The requested fill exceeds the order's remaining quantity."
    },
    {
      "code": 6027,
      "name": "invalidCurveBucketCount",
      "msg": "A curve market must use an odd bucket count between three and forty-one."
    },
    {
      "code": 6028,
      "name": "curveJackpotTooHigh",
      "msg": "The curve jackpot share exceeds the protocol maximum."
    },
    {
      "code": 6029,
      "name": "invalidCurveValue",
      "msg": "The normalized curve value must be between negative one and positive one."
    },
    {
      "code": 6030,
      "name": "invalidCurveBucket",
      "msg": "The curve bucket is outside this market's range."
    },
    {
      "code": 6031,
      "name": "curveStakeLimitExceeded",
      "msg": "The curve stake cap has been reached."
    },
    {
      "code": 6032,
      "name": "amountExceedsPosition",
      "msg": "The requested amount exceeds this curve position's stake."
    },
    {
      "code": 6033,
      "name": "positionAlreadyClaimed",
      "msg": "This curve position has already been claimed."
    },
    {
      "code": 6034,
      "name": "wrongCurveVault",
      "msg": "The curve vault does not belong to this market."
    },
    {
      "code": 6035,
      "name": "wrongCurveMarket",
      "msg": "The curve position does not belong to this market."
    },
    {
      "code": 6036,
      "name": "insufficientCurveCollateral",
      "msg": "The curve vault does not contain the market's recorded collateral."
    },
    {
      "code": 6037,
      "name": "invalidCurveDenominator",
      "msg": "The curve payout denominator is invalid."
    },
    {
      "code": 6038,
      "name": "invalidCurveAccounting",
      "msg": "The curve market's aggregate stake accounting is inconsistent."
    },
    {
      "code": 6039,
      "name": "curveRecoveryTooEarly",
      "msg": "The resolver recovery delay has not elapsed."
    },
    {
      "code": 6040,
      "name": "duplicateAccount",
      "msg": "Two accounts that must be distinct resolve to the same address."
    }
  ],
  "types": [
    {
      "name": "completeSetMerged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "openInterest",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "completeSetMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "openInterest",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "tradingFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "curveMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "curveMarketStatus"
              }
            }
          },
          {
            "name": "kernelVersion",
            "type": "u8"
          },
          {
            "name": "jackpotLeverageCap",
            "type": "u8"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "metricHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rulesHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resolutionReportHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "opensAt",
            "type": "i64"
          },
          {
            "name": "closesAt",
            "type": "i64"
          },
          {
            "name": "resolveAfter",
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "normalizedOutcome",
            "type": "i32"
          },
          {
            "name": "bucketCount",
            "type": "u8"
          },
          {
            "name": "winningBucket",
            "type": "u8"
          },
          {
            "name": "jackpotBps",
            "type": "u16"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          },
          {
            "name": "payoutPool",
            "type": "u64"
          },
          {
            "name": "jackpotPool",
            "type": "u64"
          },
          {
            "name": "curvePool",
            "type": "u64"
          },
          {
            "name": "exactStake",
            "type": "u64"
          },
          {
            "name": "weightedStake",
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          },
          {
            "name": "bucketStakes",
            "type": {
              "array": [
                "u64",
                41
              ]
            }
          }
        ]
      }
    },
    {
      "name": "curveMarketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "metricHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rulesHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "bucketCount",
            "type": "u8"
          },
          {
            "name": "jackpotBps",
            "type": "u16"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "kernelVersion",
            "type": "u8"
          },
          {
            "name": "jackpotLeverageCap",
            "type": "u8"
          },
          {
            "name": "opensAt",
            "type": "i64"
          },
          {
            "name": "closesAt",
            "type": "i64"
          },
          {
            "name": "resolveAfter",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "curveMarketInvalidated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "resolutionReportHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "curveMarketRecovered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "resolutionReportHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "recoveredAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "curveMarketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "normalizedOutcome",
            "type": "i32"
          },
          {
            "name": "winningBucket",
            "type": "u8"
          },
          {
            "name": "resolutionReportHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          },
          {
            "name": "payoutPool",
            "type": "u64"
          },
          {
            "name": "jackpotPool",
            "type": "u64"
          },
          {
            "name": "curvePool",
            "type": "u64"
          },
          {
            "name": "exactStake",
            "type": "u64"
          },
          {
            "name": "weightedStake",
            "type": "u64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "curveMarketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "unresolved"
          },
          {
            "name": "resolved"
          },
          {
            "name": "invalid"
          }
        ]
      }
    },
    {
      "name": "curvePosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curvePositionClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curvePositionOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "positionStake",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curveStakeAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "positionStake",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curveStakeWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "positionStake",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "exchangeConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "tradingFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "limitOrder",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "orderSide"
              }
            }
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "outcomeMint",
            "type": "pubkey"
          },
          {
            "name": "escrowMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "priceMicroUsdc",
            "type": "u64"
          },
          {
            "name": "originalQuantity",
            "type": "u64"
          },
          {
            "name": "remainingQuantity",
            "type": "u64"
          },
          {
            "name": "quoteFilled",
            "type": "u64"
          },
          {
            "name": "feePaid",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "openInterest",
            "type": "u64"
          },
          {
            "name": "totalRedeemed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "questionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rulesHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "yesMint",
            "type": "pubkey"
          },
          {
            "name": "noMint",
            "type": "pubkey"
          },
          {
            "name": "opensAt",
            "type": "i64"
          },
          {
            "name": "closesAt",
            "type": "i64"
          },
          {
            "name": "resolveAfter",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "resolutionOutcome"
              }
            }
          },
          {
            "name": "resolutionReportHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "openInterest",
            "type": "u64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "unresolved"
          },
          {
            "name": "resolvedYes"
          },
          {
            "name": "resolvedNo"
          },
          {
            "name": "invalid"
          }
        ]
      }
    },
    {
      "name": "orderCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "refundAmount",
            "type": "u64"
          },
          {
            "name": "unfilledQuantity",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderFilled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "orderSide"
              }
            }
          },
          {
            "name": "quantity",
            "type": "u64"
          },
          {
            "name": "quoteAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "remainingQuantity",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "orderSide"
              }
            }
          },
          {
            "name": "outcomeMint",
            "type": "pubkey"
          },
          {
            "name": "priceMicroUsdc",
            "type": "u64"
          },
          {
            "name": "quantity",
            "type": "u64"
          },
          {
            "name": "escrowAmount",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "orderSide",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "bid"
          },
          {
            "name": "ask"
          }
        ]
      }
    },
    {
      "name": "pauseChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "positionRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "claimMint",
            "type": "pubkey"
          },
          {
            "name": "burnedAmount",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "totalRedeemed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "resolutionOutcome",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yes"
          },
          {
            "name": "no"
          },
          {
            "name": "invalid"
          }
        ]
      }
    },
    {
      "name": "resolverChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousResolver",
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "scarcityMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "yesMint",
            "type": "pubkey"
          },
          {
            "name": "noMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "questionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rulesHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resolutionReportHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "opensAt",
            "type": "i64"
          },
          {
            "name": "closesAt",
            "type": "i64"
          },
          {
            "name": "resolveAfter",
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "openInterest",
            "type": "u64"
          },
          {
            "name": "totalRedeemed",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
