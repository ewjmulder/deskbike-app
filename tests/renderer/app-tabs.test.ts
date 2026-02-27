import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseState = vi.hoisted(() => vi.fn())

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useState: mockUseState,
  }
})

type Tab = 'live' | 'history'

type ElementLike = {
  type: unknown
  props: {
    children?: unknown
    style?: Record<string, unknown>
  }
}

function asChildrenArray(children: unknown): unknown[] {
  return Array.isArray(children) ? children : [children]
}

async function renderAppWithTab(activeTab: Tab): Promise<ElementLike> {
  mockUseState.mockImplementationOnce(() => [activeTab, vi.fn()])
  const { default: App } = await import('../../src/renderer/src/App')
  return App() as ElementLike
}

describe('App tab mounting regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    Object.defineProperty(globalThis, 'window', {
      value: { deskbike: { isWidget: () => false } },
      configurable: true,
      writable: true,
    })
  })

  it('keeps DiagnosticTab mounted when History is active', async () => {
    const root = await renderAppWithTab('history')
    const children = asChildrenArray(root.props.children)

    const liveContainer = children[1] as ElementLike
    expect(liveContainer.type).toBe('div')
    expect(liveContainer.props.style?.display).toBe('none')

    const diagnosticElement = liveContainer.props.children as ElementLike
    expect(typeof diagnosticElement.type).toBe('function')
    expect((diagnosticElement.type as { name?: string }).name).toBe('DiagnosticTab')

    const historyElement = children[2] as ElementLike
    expect(typeof historyElement.type).toBe('function')
    expect((historyElement.type as { name?: string }).name).toBe('HistoryTab')
  })

  it('hides HistoryTab when Live is active', async () => {
    const root = await renderAppWithTab('live')
    const children = asChildrenArray(root.props.children)

    const liveContainer = children[1] as ElementLike
    expect(liveContainer.props.style?.display).toBe('block')

    const historyElement = children[2]
    expect(historyElement).toBeNull()
  })
})
