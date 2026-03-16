#!/usr/bin/env node

import 'dotenv/config'
import { createInterface } from 'readline'

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
}

function print(msg, color = '') {
  console.log(color + msg + colors.reset)
}

async function startGateway() {
  print('\nStarting CC-WAG Gateway...\n', colors.green)
  await import('./gateway.js')
}

async function terminalChat() {
  print('\nStarting Terminal Chat...\n', colors.cyan)
  print('Initializing agent...', colors.dim)

  try {
    const { default: ClaudeAgent } = await import('./agent/claude-agent.js')

    const agent = new ClaudeAgent({
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite', 'Skill'],
      maxTurns: 50,
      permissionMode: 'bypassPermissions'
    })

    if (agent.provider.initialize) {
      try {
        await agent.provider.initialize()
        print('  Claude ready', colors.green)
      } catch (err) {
        print('  Provider: ' + err.message, colors.yellow)
      }
    }

    print('\nChat started! Type "exit" or "quit" to end.\n', colors.green + colors.bold)

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    })

    const prompt = () => {
      rl.question(colors.bold + '  You: ' + colors.reset, async (text) => {
        if (!text.trim()) {
          prompt()
          return
        }

        if (['exit', 'quit', '/exit', '/quit'].includes(text.trim().toLowerCase())) {
          print('\nGoodbye!\n', colors.cyan)
          agent.stopCron()
          rl.close()
          process.exit(0)
        }

        const sessionKey = `terminal:cli`

        try {
          let isFirstText = true
          for await (const chunk of agent.run({
            message: text,
            sessionKey,
            platform: 'terminal'
          })) {
            if (chunk.type === 'text' && chunk.content) {
              let content = chunk.content
              if (isFirstText) {
                content = content.replace(/^[\s\n\r]+/, '')
                if (!content) continue
                process.stdout.write('\n' + colors.cyan + '  CC: ' + colors.reset + content)
                isFirstText = false
              } else {
                process.stdout.write(content)
              }
            } else if (chunk.type === 'tool_use') {
              process.stdout.write(colors.dim + `\n  [${chunk.name}]` + colors.reset)
            } else if (chunk.type === 'done') {
              console.log('\n')
            }
          }
        } catch (err) {
          print('\n  Error: ' + err.message + '\n', colors.red)
        }

        prompt()
      })
    }

    prompt()

  } catch (err) {
    print('\nFailed to start chat: ' + err.message, colors.red)
    process.exit(1)
  }
}

function showHelp() {
  print('\nCC-WAG: Claude Code WhatsApp Gateway\n', colors.cyan + colors.bold)
  print('Usage: node src/cli.js [command]\n', colors.bold)
  print('Commands:')
  print('  start    Start the WhatsApp gateway', colors.green)
  print('  chat     Terminal chat with CC', colors.cyan)
  print('  help     Show this help message', colors.dim)
  print('')
  print('Run without arguments for help.')
  console.log('')
}

// Parse command line arguments
const args = process.argv.slice(2)
const command = args[0] || 'help'

switch (command) {
  case 'start':
    startGateway().catch(err => {
      console.error('Error:', err)
      process.exit(1)
    })
    break

  case 'chat':
    terminalChat().catch(err => {
      console.error('Error:', err)
      process.exit(1)
    })
    break

  case 'help':
  case '--help':
  case '-h':
  default:
    showHelp()
    break
}
