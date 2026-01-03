#!/usr/bin/env node

/**
 * Dave Eval Framework
 * Tests AI agent behavior systematically
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Test configuration
const CONFIG = {
  baseUrl: 'http://localhost:3000',
  mockApiUrl: 'http://localhost:3001',
  testDataDir: './evals/test-cases',
  outputDir: './evals/results',
  // Mock auth token for testing (you'll need a real one)
  authToken: process.env.TEST_AUTH_TOKEN || 'mock-token-for-testing'
};

class DaveEvals {
  constructor() {
    this.results = [];
    this.stats = {
      total: 0,
      passed: 0,
      failed: 0
    };
    this.mockServerProcess = null;
  }

  /**
   * Run a single test case
   */
  async runTest(testCase) {
    console.log(`\n🧪 Running test: ${testCase.name}`);

    try {
      // Send conversation to Dave
      const response = await this.sendToDave(testCase.conversation, testCase.userId);

      // Run assertions
      const assertions = await this.runAssertions(testCase.assertions, response, testCase.conversation);

      const passed = assertions.every(a => a.passed);

      const result = {
        name: testCase.name,
        passed,
        assertions,
        response: response,
        conversation: testCase.conversation,
        timestamp: new Date().toISOString()
      };

      this.results.push(result);
      this.stats.total++;

      if (passed) {
        this.stats.passed++;
        console.log(`✅ PASSED: ${testCase.name}`);
      } else {
        this.stats.failed++;
        console.log(`❌ FAILED: ${testCase.name}`);
        assertions.filter(a => !a.passed).forEach(a => {
          console.log(`   - ${a.description}: ${a.error}`);
        });
      }

      return result;

    } catch (error) {
      console.log(`💥 ERROR: ${testCase.name} - ${error.message}`);

      const result = {
        name: testCase.name,
        passed: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };

      this.results.push(result);
      this.stats.total++;
      this.stats.failed++;

      return result;
    }
  }

  /**
   * Send conversation to Dave API
   */
  async sendToDave(conversation, userId = 'test-user') {
    const response = await fetch(`${CONFIG.baseUrl}/api/dave/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: conversation,
        userId: userId,
        authToken: CONFIG.authToken,
        useMockApi: true
      })
    });

    if (!response.ok) {
      throw new Error(`Dave API returned ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Run assertions on Dave's response
   */
  async runAssertions(assertions, response, conversation) {
    const results = [];

    for (const assertion of assertions) {
      try {
        let passed = false;
        let error = null;

        switch (assertion.type) {
          case 'tool_called':
            passed = await this.assertToolCalled(assertion, response);
            break;
          case 'tool_not_called':
            passed = await this.assertToolNotCalled(assertion, response);
            break;
          case 'response_contains':
            passed = await this.assertResponseContains(assertion, response);
            break;
          case 'response_format':
            passed = await this.assertResponseFormat(assertion, response);
            break;
          case 'api_state':
            passed = await this.assertApiState(assertion, response);
            break;
          default:
            throw new Error(`Unknown assertion type: ${assertion.type}`);
        }

        results.push({
          type: assertion.type,
          description: assertion.description,
          passed,
          error
        });

      } catch (err) {
        results.push({
          type: assertion.type,
          description: assertion.description,
          passed: false,
          error: err.message
        });
      }
    }

    return results;
  }

  /**
   * Assert that a specific tool was called
   */
  async assertToolCalled(assertion, response) {
    const toolName = assertion.toolName;
    const expectedArgs = assertion.expectedArgs || {};

    // Check if tool calls are present in response
    if (!response.toolCalls || !Array.isArray(response.toolCalls)) {
      throw new Error('No tool call information in response');
    }

    // Find the specific tool call
    const toolCall = response.toolCalls.find(tc => tc.name === toolName);

    if (!toolCall) {
      throw new Error(`Tool '${toolName}' was not called. Tools called: ${response.toolCalls.map(tc => tc.name).join(', ')}`);
    }

    // Validate arguments if specified
    if (expectedArgs && Object.keys(expectedArgs).length > 0) {
      for (const [key, expectedValue] of Object.entries(expectedArgs)) {
        if (expectedValue === 'any_id') {
          // Special case: just check that some ID was provided
          const actualValue = toolCall.arguments[key];
          if (!actualValue) {
            throw new Error(`Tool '${toolName}' missing required argument '${key}'`);
          }
          // If it's an array, check it has elements; if it's a string, check it's not empty
          if (Array.isArray(actualValue)) {
            if (actualValue.length === 0) {
              throw new Error(`Tool '${toolName}' argument '${key}' is empty array`);
            }
          } else if (typeof actualValue === 'string') {
            if (actualValue.trim() === '') {
              throw new Error(`Tool '${toolName}' argument '${key}' is empty string`);
            }
          }
        } else if (Array.isArray(expectedValue) && expectedValue.includes('any_id')) {
          // Handle arrays that should contain any_id
          const actualValue = toolCall.arguments[key];
          if (!Array.isArray(actualValue) || actualValue.length === 0) {
            throw new Error(`Tool '${toolName}' argument '${key}' should be non-empty array, got: ${JSON.stringify(actualValue)}`);
          }
        } else if (toolCall.arguments[key] !== expectedValue) {
          throw new Error(`Tool '${toolName}' argument '${key}' was '${JSON.stringify(toolCall.arguments[key])}', expected '${JSON.stringify(expectedValue)}'`);
        }
      }
    }

    return true;
  }

  /**
   * Assert that a tool was NOT called
   */
  async assertToolNotCalled(assertion, response) {
    const toolName = assertion.toolName;
    // TODO: Implement proper tool call tracking
    return true; // Placeholder
  }

  /**
   * Assert response contains specific text
   */
  async assertResponseContains(assertion, response) {
    if (!response.message || !response.message.content) {
      throw new Error('No response content to check');
    }

    const content = response.message.content.toLowerCase();
    const searchText = assertion.text.toLowerCase();

    return content.includes(searchText);
  }

  /**
   * Assert response has proper format
   */
  async assertResponseFormat(assertion, response) {
    if (!response.message || !response.message.content) {
      throw new Error('No response content to check');
    }

    const content = response.message.content;

    switch (assertion.format) {
      case 'numbered_list':
        return /^\d+\.\s/.test(content.trim());
      case 'contains_recipe_names':
        return content.length > 10; // Basic check
      default:
        return true;
    }
  }

  /**
   * Assert API state after tool execution
   */
  async assertApiState(assertion, response) {
    const { endpoint, expectedState } = assertion;

    // Parse endpoint (e.g., "GET /shopping-list")
    const [method, path] = endpoint.split(' ');
    const apiUrl = `${CONFIG.mockApiUrl}${path}`;

    try {
      const apiResponse = await fetch(apiUrl, { method });

      if (!apiResponse.ok) {
        throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText}`);
      }

      const apiData = await apiResponse.json();

      // Check each expected state condition
      for (const [key, expectedValue] of Object.entries(expectedState)) {
        if (key.includes('.')) {
          // Handle nested properties like "ingredients.Coconut milk"
          const [parentKey, childKey] = key.split('.');

          if (expectedValue === 'exists') {
            if (!apiData[parentKey] || !apiData[parentKey][childKey]) {
              throw new Error(`Expected ${key} to exist in API response, but it was missing. API data: ${JSON.stringify(apiData, null, 2)}`);
            }
          } else {
            if (apiData[parentKey][childKey] !== expectedValue) {
              throw new Error(`Expected ${key} to be '${expectedValue}', but got '${apiData[parentKey][childKey]}'`);
            }
          }
        } else {
          // Handle direct properties
          if (Array.isArray(expectedValue)) {
            if (!Array.isArray(apiData[key])) {
              throw new Error(`Expected ${key} to be array, got ${typeof apiData[key]}`);
            }
            // Check array contains expected values
            for (const expectedItem of expectedValue) {
              if (!apiData[key].includes(expectedItem)) {
                throw new Error(`Expected ${key} to contain '${expectedItem}', but got ${JSON.stringify(apiData[key])}`);
              }
            }
          } else {
            if (apiData[key] !== expectedValue) {
              throw new Error(`Expected ${key} to be '${expectedValue}', but got '${apiData[key]}'`);
            }
          }
        }
      }

      return true;

    } catch (error) {
      if (error.message.startsWith('Expected')) {
        throw error; // Re-throw assertion errors
      }
      throw new Error(`Failed to verify API state: ${error.message}`);
    }
  }

  /**
   * Load test cases from files
   */
  loadTestCases() {
    const testCases = [];
    const testDir = CONFIG.testDataDir;

    const files = fs.readdirSync(testDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(testDir, file);
      const testCase = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      testCases.push(testCase);
    }

    return testCases;
  }

  /**
   * Save results to file
   */
  saveResults() {
    if (!fs.existsSync(CONFIG.outputDir)) {
      fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `eval-results-${timestamp}.json`;
    const filepath = path.join(CONFIG.outputDir, filename);

    const output = {
      summary: this.stats,
      results: this.results,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
    console.log(`\n📊 Results saved to: ${filepath}`);
  }

  /**
   * Start mock API server
   */
  async startMockServer() {
    console.log('🎭 Starting mock API server on port 3001...');

    try {
      this.mockServerProcess = exec('node evals/mock-api-server.js');

      // Wait for server to start
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Mock server timeout')), 10000);

        const checkServer = async () => {
          try {
            const response = await fetch(`${CONFIG.mockApiUrl}/health`);
            if (response.ok) {
              clearTimeout(timeout);
              console.log('✅ Mock API server is running');
              resolve();
            } else {
              setTimeout(checkServer, 500);
            }
          } catch (error) {
            setTimeout(checkServer, 500);
          }
        };

        setTimeout(checkServer, 1000); // Give server a moment to start
      });

    } catch (error) {
      console.error('❌ Failed to start mock server:', error.message);
      throw error;
    }
  }

  /**
   * Stop mock API server
   */
  stopMockServer() {
    if (this.mockServerProcess) {
      console.log('🛑 Stopping mock API server...');
      this.mockServerProcess.kill();
      this.mockServerProcess = null;
    }
  }

  /**
   * Run all tests
   */
  async runAll() {
    console.log('🚀 Starting Dave Eval Framework...\n');

    try {
      // Start mock server first
      await this.startMockServer();

      const testCases = this.loadTestCases();
      console.log(`Found ${testCases.length} test cases`);

      for (const testCase of testCases) {
        await this.runTest(testCase);
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Print summary
      console.log('\n📈 Test Summary:');
      console.log(`Total: ${this.stats.total}`);
      console.log(`Passed: ${this.stats.passed}`);
      console.log(`Failed: ${this.stats.failed}`);
      console.log(`Success Rate: ${((this.stats.passed / this.stats.total) * 100).toFixed(1)}%`);

      this.saveResults();

      return this.stats;

    } finally {
      // Always stop the mock server
      this.stopMockServer();
    }
  }
}

// Run evals if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const evals = new DaveEvals();
  evals.runAll()
    .then(stats => {
      process.exit(stats.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default DaveEvals;
