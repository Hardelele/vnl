/**
 * Форма «в каталог»: тип клетки проекта становится каталожной записью (#567).
 *
 * Почему форма, а не кнопка. Тип, приехавший в проект из разобранного
 * паттерна, -- это идентификатор и мембрана, и больше ничего. Каталогу этого
 * мало: строка палитры подписана человеческим именем, а наведение
 * расшифровывает, чем клетка занята в схеме (#541). Ни того ни другого у
 * `target` нет, и придумать их за человека не из чего -- «Target» из
 * идентификатора сообщает ровно столько же, сколько сам `target`.
 *
 * Спрашивается только то, чего сервер не знает. Мембрана не спрашивается и не
 * показывается полями: она уже лежит в проекте, оттуда сервер её и возьмёт.
 * Форма, в которой порог можно было бы заодно поправить, означала бы второй
 * редактор мембраны рядом с панелью свойств -- и две правды о том, где её
 * правят.
 *
 * Столкновение имён спрашивается здесь же, до отправки. Проверку делает и
 * сервер -- это он держит правило, и без подтверждения он откажет, -- но
 * спросить человека может только экран, и палитра у него уже в руках: та же
 * `palette`, по которой рисуется список слева. Ждать отказа, чтобы задать
 * вопрос вторым заходом, значило бы показать ошибку там, где ошибки нет:
 * перекрыть встроенную клетку своей можно и нужно уметь, вопрос лишь в том,
 * этого ли человек хотел.
 */

import { useState } from 'react'

import type { CellDraft } from '../../model/cells'
import type { CellKind } from '../../model/types'

export interface CellToCatalogProps {
  /** Тип проекта, который кладут. Он же идентификатор будущей записи. */
  type: string
  /**
   * Что уже лежит в каталоге под этим идентификатором, если лежит.
   *
   * Приходит готовой клеткой палитры, а не флажком «занято»: человеку надо
   * сказать, что именно он собирается перекрыть, -- «в каталоге уже есть
   * `pv`» не отвечает на вопрос, та ли это клетка, которую он имел в виду.
   */
  standing?: CellKind
  busy: boolean
  onPut: (draft: CellDraft) => void
  onCancel: () => void
}

export function CellToCatalog({
  type,
  standing,
  busy,
  onPut,
  onCancel,
}: CellToCatalogProps) {
  // Умолчания пустые, а не собранные из идентификатора. Подставленное имя
  // «target» человек оставит как есть -- предложенное поле читается как
  // заполненное, -- и в каталоге окажется ровно то, из-за чего задача и
  // заводилась: строка, которую по имени не выбрать.
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [replace, setReplace] = useState(false)

  const ready =
    Boolean(name.trim()) && Boolean(note.trim()) && (!standing || replace)

  return (
    <form
      className="panel sb-save sb-adopt"
      aria-label="Положить клетку в каталог"
      onSubmit={(event) => {
        event.preventDefault()
        onPut({ type, name: name.trim(), note: note.trim(), replace })
      }}
    >
      <div className="sb-section">В каталог: клетка {type}</div>
      <p className="sb-note">
        В каталог уедет копия: правка порога в этом проекте её больше не тронет.
      </p>

      <label className="sb-field sb-wide">
        Имя
        <input
          type="text"
          value={name}
          placeholder="Клетка-мишень"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="sb-field sb-wide">
        Чем занята в схеме
        <textarea
          value={note}
          placeholder="Куда сходится схема: на ней смотрят, сработало ли торможение."
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <p className="sb-note">
        Имя и объяснение обязательны: ими подписана строка каталога.
      </p>

      {/* Перекрытие -- отдельный вопрос, а не мелкий шрифт под кнопкой:
          каталог один на все проекты этой машины, и «положить» здесь значит
          «подменить клетку всюду». */}
      {standing ? (
        <label className="sb-field sb-adopt-clash">
          <input
            type="checkbox"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
          />
          <span>
            В каталоге уже есть {standing.builtin ? 'встроенная' : 'своя'} клетка{' '}
            <span className="mono">{standing.id}</span> — «{standing.name}».
            Заменить её этой: во всех проектах.
          </span>
        </label>
      ) : null}

      <div className="sb-save-actions">
        <button type="submit" className="btn-primary" disabled={busy || !ready}>
          Положить
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  )
}
