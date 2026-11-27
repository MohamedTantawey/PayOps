const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'PayOps Orchestration & FinOps API',
    version: '1.0.0',
    description:
      'Intelligent Multi-PSP Payment Router, PCI Vault Boundary, Dynamic Failover Engine, and Signed Webhooks. Authorize with Test Key `sk_test_demo_000000000000000000000000`.',
  },
  servers: [{ url: '/', description: 'Local / Current Gateway' }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Use sk_test_demo_000000000000000000000000 for Test Mode sandbox',
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/status': {
      get: {
        tags: ['Observability'],
        summary: 'Live infrastructure, AZ, Git SHA, DB/Redis latency, and connector circuit telemetry',
        security: [],
        responses: { 200: { description: 'Platform operational telemetry' } },
      },
    },
    '/api/payments/tokenize': {
      post: {
        tags: ['Vault'],
        summary: 'Tokenize raw PAN/CVV inside the isolated PCI Vault boundary',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: {
                card: { number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' },
              },
            },
          },
        },
        responses: { 201: { description: 'Vault token issued' } },
      },
    },
    '/api/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List recent PaymentIntents scoped by Test/Live mode',
        responses: { 200: { description: 'PaymentIntents list' } },
      },
      post: {
        tags: ['Payments'],
        summary: 'Create & route a PaymentIntent with automatic failover across PSPs',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string', example: 'idem_demo_001' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: {
                amount_cents: 12500,
                currency: 'USD',
                customer_email: 'buyer@acme.io',
                description: 'Enterprise SaaS Seat License',
                vault_token: 'vault_tok_test_4242424242424242',
                confirm: true,
              },
            },
          },
        },
        responses: { 201: { description: 'PaymentIntent routed and processed' } },
      },
    },
    '/api/payments/checkout/{id}': {
      get: {
        tags: ['Hosted Checkout'],
        summary: 'Read a hosted checkout session using its one-time checkout secret',
        security: [],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'X-Checkout-Secret', in: 'header', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Checkout details without the merchant API key' },
          404: { description: 'Session not found or secret is invalid' },
          410: { description: 'Checkout session expired' },
        },
      },
    },
    '/api/payments/checkout/{id}/confirm': {
      post: {
        tags: ['Hosted Checkout'],
        summary: 'Confirm a hosted checkout payment; card details stay on the PayOps origin',
        security: [],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'X-Checkout-Secret', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: {
                card: { number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' },
              },
            },
            '/api/payments/checkout/{id}/cancel': {
              post: {
                tags: ['Hosted Checkout'],
                summary: 'Cancel an unpaid hosted checkout using its one-time checkout secret',
                security: [],
                parameters: [
                  { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
                  { name: 'X-Checkout-Secret', in: 'header', required: true, schema: { type: 'string' } },
                ],
                responses: {
                  200: { description: 'Intent canceled and cancel redirect returned' },
                  404: { description: 'Session not found or secret is invalid' },
                  409: { description: 'Payment is processing, authorized, or already succeeded' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Payment outcome and success redirect URL when paid' },
          404: { description: 'Session not found or secret is invalid' },
          409: { description: 'Payment is already processing or not payable' },
          410: { description: 'Checkout session expired' },
        },
      },
    },
    '/api/payments/{id}/cancel': {
      post: {
        tags: ['Payments'],
        summary: 'Cancel an unpaid or failed payment intent',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Intent canceled' },
          409: { description: 'Payment is processing, authorized, or already succeeded' },
        },
      },
    },
    '/api/routing': {
      get: {
        tags: ['Smart Routing'],
        summary: 'Inspect active routing policy & sliding-window connector telemetry',
        responses: { 200: { description: 'Routing state' } },
      },
      put: {
        tags: ['Smart Routing'],
        summary: 'Hot-swap active routing algorithm (priority, volume_split, rule, single)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: {
                name: 'Weighted Split 70/30',
                algorithm_type: 'volume_split',
                config: {
                  splits: [
                    { connector: 'mock_stripe', weight: 70 },
                    { connector: 'mock_paymo', weight: 30 },
                  ],
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated active routing config' } },
      },
    },
    '/api/routing/chaos': {
      post: {
        tags: ['Chaos & Failover Demo'],
        summary: 'Inject outage, timeout, or failure rate on MockStripe or MockPaymob',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: { gateway: 'mock_stripe', forceMode: 'outage', failureRate: 1 },
            },
          },
        },
        responses: { 200: { description: 'Updated Mock PSP chaos state' } },
      },
    },
    '/api/webhooks/deliveries': {
      get: {
        tags: ['Webhooks'],
        summary: 'List signed webhook deliveries and HTTP status codes',
        responses: { 200: { description: 'Webhook delivery log' } },
      },
    },
  },
};

module.exports = openApiSpec;
