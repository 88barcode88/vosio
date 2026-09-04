import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml')

function withoutComments(line: string): string {
  let quoted = false
  let quote = ''

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if ((character === '"' || character === "'") && (!quoted || character === quote)) {
      quoted = !quoted
      quote = quoted ? character : ''
    }
    if (character === '#' && !quoted) return line.slice(0, index)
  }

  return line
}

function mappingKeysAtIndent(lines: string[], expectedIndent: number): string[] {
  return lines
    .map(withoutComments)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      const match = new RegExp(`^\\s{${expectedIndent}}([^:]+):(?:\\s|$)`).exec(line)
      return match ? [match[1].trim()] : []
    })
}

function topLevelKeys(lines: string[]): string[] {
  return mappingKeysAtIndent(lines, 0)
}

function workflowSection(lines: string[], section: string): string[] {
  const sectionIndex = lines.findIndex((line) => {
    const clean = withoutComments(line)
    return new RegExp(`^${section}:\\s*$`).test(clean)
  })
  if (sectionIndex < 0) return []

  const sectionIndent = lines[sectionIndex].match(/^\s*/)?.[0].length ?? 0
  const sectionLines: string[] = []
  for (const line of lines.slice(sectionIndex + 1)) {
    const clean = withoutComments(line)
    if (clean.trim().length === 0) {
      sectionLines.push(line)
      continue
    }
    const indent = clean.match(/^\s*/)?.[0].length ?? 0
    if (indent <= sectionIndent) break
    sectionLines.push(line)
  }
  return sectionLines
}

describe('GitHub Actions CI workflow contract', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const lines = workflow.split(/\r?\n/)

  it('uses exactly one default pull_request trigger and no other automatic trigger', () => {
    const keys = topLevelKeys(lines)
    const triggerDeclarations = keys.filter((key) => key === 'on')
    const triggerLines = workflowSection(lines, 'on')
    const triggerIndent = triggerLines[0]?.match(/^\s*/)?.[0].length ?? -1
    const triggerKeys = mappingKeysAtIndent(triggerLines, triggerIndent)

    expect(triggerDeclarations).toHaveLength(1)
    expect(triggerKeys).toEqual(['pull_request'])
    expect(triggerLines.some((line) => /\btypes\s*:/.test(withoutComments(line)))).toBe(false)
    expect(keys).not.toContain('push')
  })

  it('uses least-privilege permissions, PR concurrency, and a bounded job timeout', () => {
    expect(workflow).toMatch(/^permissions:\s*$/m)
    expect(workflow).toMatch(/^\s+contents:\s*read\s*$/m)
    expect(workflow).toMatch(/^concurrency:\s*$/m)
    expect(workflow).toMatch(/^\s+group:\s*ci-pr-\$\{\{ github\.event\.pull_request\.number \}\}\s*$/m)
    expect(workflow).toMatch(/^\s+cancel-in-progress:\s*true\s*$/m)
    expect(workflow).toMatch(/^\s+timeout-minutes:\s*20\s*$/m)
  })

  it('keeps application Node 22 and reviewed Node24-runtime action majors without ref overrides', () => {
    expect(workflow).toMatch(/^\s+- uses:\s*actions\/checkout@v7(?:\.\d+\.\d+)?\s*$/m)
    expect(workflow).toMatch(/^\s+- uses:\s*actions\/setup-node@v7(?:\.\d+\.\d+)?\s*$/m)
    expect(workflow).toMatch(/^\s+node-version:\s*22\s*$/m)
    expect(workflow).toMatch(/^\s+cache:\s*npm\s*$/m)
    expect(workflow).not.toMatch(/^\s+ref:\s*.+$/m)
  })

  it('runs the production audit after npm ci and before the project checks/build', () => {
    const installIndex = workflow.indexOf('run: npm ci')
    const auditIndex = workflow.indexOf('run: npm audit --omit=dev --audit-level=high')
    const checkIndex = workflow.indexOf('run: npm run check')
    const buildIndex = workflow.indexOf('run: npm run build')

    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(auditIndex).toBeGreaterThan(installIndex)
    expect(auditIndex).toBeLessThan(checkIndex)
    expect(auditIndex).toBeLessThan(buildIndex)
  })
})
