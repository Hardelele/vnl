/**
 * Общее состояние интерфейса: что выбрано и где стоит курсор времени.
 *
 * Свой маленький стор вместо контекста React не из любви к велосипедам:
 * курсор времени двигается на каждый mousemove, и через контекст это
 * перерисовывало бы всё дерево. Здесь компонент подписывается на конкретную
 * величину и просыпается только когда меняется она.
 */

import { useSyncExternalStore } from 'react'

export interface UiState {
  /** Нейрон, открытый в инспекторе. */
  selected: string | null
  /** Позиция курсора времени в мс; null -- курсора нет. */
  cursor: number | null
}

type Listener = () => void

export interface Store<T> {
  getState(): T
  setState(patch: Partial<T>): void
  subscribe(listener: Listener): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<Listener>()

  return {
    getState: () => state,
    setState(patch) {
      let changed = false
      for (const key of Object.keys(patch) as (keyof T)[]) {
        const value = patch[key]
        if (value !== undefined && !Object.is(state[key], value)) {
          changed = true
          break
        }
      }
      if (!changed) return
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const uiStore = createStore<UiState>({ selected: null, cursor: null })

export function useUi<S>(select: (state: UiState) => S): S {
  return useSyncExternalStore(
    uiStore.subscribe,
    () => select(uiStore.getState()),
    () => select(uiStore.getState()),
  )
}

export const selectNeuron = (id: string | null) => uiStore.setState({ selected: id })
export const moveCursor = (time: number | null) => uiStore.setState({ cursor: time })
