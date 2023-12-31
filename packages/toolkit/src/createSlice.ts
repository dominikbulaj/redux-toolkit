import type { Action, UnknownAction, Reducer } from 'redux'
import type { Selector } from 'reselect'
import type {
  ActionCreatorWithoutPayload,
  PayloadAction,
  PayloadActionCreator,
  PrepareAction,
  _ActionCreatorWithPreparedPayload,
} from './createAction'
import { createAction } from './createAction'
import type {
  ActionMatcherDescriptionCollection,
  CaseReducer,
  ReducerWithInitialState,
} from './createReducer'
import { createReducer, makeGetInitialState } from './createReducer'
import type { ActionReducerMapBuilder, TypedActionCreator } from './mapBuilders'
import { executeReducerBuilderCallback } from './mapBuilders'
import type {
  Id,
  KeysForValueOfType,
  TypeGuard,
  UnionToIntersection,
} from './tsHelpers'
import type { InjectConfig } from './combineSlices'
import type {
  AsyncThunk,
  AsyncThunkConfig,
  AsyncThunkOptions,
  AsyncThunkPayloadCreator,
  OverrideThunkApiConfigs,
} from './createAsyncThunk'
import { createAsyncThunk } from './createAsyncThunk'
import { emplace } from './utils'

export enum ReducerType {
  reducer = 'reducer',
  reducerWithPrepare = 'reducerWithPrepare',
  asyncThunk = 'asyncThunk',
}

export interface ReducerTypes extends Record<ReducerType, true> {}

export type RegisteredReducerType = KeysForValueOfType<ReducerTypes, true>

export interface ReducerDefinition<
  T extends RegisteredReducerType = RegisteredReducerType
> {
  _reducerDefinitionType: T
}

export interface SliceReducerCreators<
  State = any,
  CaseReducers extends SliceCaseReducers<State> = SliceCaseReducers<State>,
  Name extends string = string
> {
  [ReducerType.reducer]: {
    create(
      caseReducer: CaseReducer<State, PayloadAction>
    ): CaseReducerDefinition<State, PayloadAction>
    create<Payload = any>(
      caseReducer: CaseReducer<State, PayloadAction<Payload>>
    ): CaseReducerDefinition<State, PayloadAction<Payload>>
    actions: {
      [ReducerName in keyof CaseReducers as CaseReducers[ReducerName] extends CaseReducer<
        State,
        any
      >
        ? ReducerName
        : never]: ActionCreatorForCaseReducer<
        CaseReducers[ReducerName],
        SliceActionType<Name, ReducerName>
      >
    }
    caseReducers: {
      [ReducerName in keyof CaseReducers as CaseReducers[ReducerName] extends CaseReducer<
        State,
        any
      >
        ? ReducerName
        : never]: CaseReducers[ReducerName]
    }
  }
  [ReducerType.reducerWithPrepare]: {
    create<Prepare extends PrepareAction<any>>(
      prepare: Prepare,
      reducer: CaseReducer<
        State,
        ReturnType<_ActionCreatorWithPreparedPayload<Prepare>>
      >
    ): PreparedCaseReducerDefinition<State, Prepare>
    actions: {
      [ReducerName in keyof CaseReducers as CaseReducers[ReducerName] extends CaseReducerWithPrepare<
        State,
        any
      >
        ? ReducerName
        : never]: CaseReducers[ReducerName] extends { prepare: any }
        ? ActionCreatorForCaseReducerWithPrepare<
            CaseReducers[ReducerName],
            SliceActionType<Name, ReducerName>
          >
        : never
    }
    caseReducers: {
      [ReducerName in keyof CaseReducers as CaseReducers[ReducerName] extends CaseReducerWithPrepare<
        State,
        any
      >
        ? ReducerName
        : never]: CaseReducers[ReducerName] extends { reducer: infer Reducer }
        ? Reducer
        : never
    }
  }
  [ReducerType.asyncThunk]: {
    create: AsyncThunkCreator<State>
    actions: {
      [ReducerName in keyof CaseReducers as CaseReducers[ReducerName] extends AsyncThunkSliceReducerDefinition<
        State,
        any,
        any,
        any
      >
        ? ReducerName
        : never]: CaseReducers[ReducerName] extends AsyncThunkSliceReducerDefinition<
        any,
        infer ThunkArg,
        infer Returned,
        infer ThunkApiConfig
      >
        ? AsyncThunk<Returned, ThunkArg, ThunkApiConfig>
        : never
    }
    caseReducers: {
      [ReducerName in keyof CaseReducers as CaseReducers[ReducerName] extends AsyncThunkSliceReducerDefinition<
        State,
        any,
        any,
        any
      >
        ? ReducerName
        : never]: CaseReducers[ReducerName] extends AsyncThunkSliceReducerDefinition<
        State,
        any,
        any,
        any
      >
        ? Id<
            Pick<
              Required<CaseReducers[ReducerName]>,
              'fulfilled' | 'rejected' | 'pending' | 'settled'
            >
          >
        : never
    }
  }
}

export type ReducerCreators<
  State,
  CreatorMap extends Record<string, RegisteredReducerType>
> = {
  reducer: SliceReducerCreators<State>[ReducerType.reducer]['create']
  preparedReducer: SliceReducerCreators<State>[ReducerType.reducerWithPrepare]['create']
} & {
  [Name in keyof CreatorMap]: SliceReducerCreators<State>[CreatorMap[Name]]['create']
}

interface ReducerHandlingContext<State> {
  sliceCaseReducersByType: Record<string, CaseReducer<State, any>>
  sliceMatchers: ActionMatcherDescriptionCollection<State>

  sliceCaseReducersByName: Record<string, any>
  actionCreators: Record<string, any>
}

interface ReducerHandlingContextMethods<State> {
  /**
   * Adds a case reducer to handle a single action type.
   * @param actionCreator - Either a plain action type string, or an action creator generated by [`createAction`](./createAction) that can be used to determine the action type.
   * @param reducer - The actual case reducer function.
   */
  addCase<ActionCreator extends TypedActionCreator<string>>(
    actionCreator: ActionCreator,
    reducer: CaseReducer<State, ReturnType<ActionCreator>>
  ): ReducerHandlingContextMethods<State>
  /**
   * Adds a case reducer to handle a single action type.
   * @param actionCreator - Either a plain action type string, or an action creator generated by [`createAction`](./createAction) that can be used to determine the action type.
   * @param reducer - The actual case reducer function.
   */
  addCase<Type extends string, A extends Action<Type>>(
    type: Type,
    reducer: CaseReducer<State, A>
  ): ReducerHandlingContextMethods<State>

  /**
   * Allows you to match incoming actions against your own filter function instead of only the `action.type` property.
   * @remarks
   * If multiple matcher reducers match, all of them will be executed in the order
   * they were defined in - even if a case reducer already matched.
   * All calls to `builder.addMatcher` must come after any calls to `builder.addCase` and before any calls to `builder.addDefaultCase`.
   * @param matcher - A matcher function. In TypeScript, this should be a [type predicate](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates)
   *   function
   * @param reducer - The actual case reducer function.
   *
   */
  addMatcher<A>(
    matcher: TypeGuard<A>,
    reducer: CaseReducer<State, A extends Action ? A : A & Action>
  ): ReducerHandlingContextMethods<State>
  /**
   * Add an action to be exposed under the final `slice.actions` key.
   * @param name The key to be exposed as.
   * @param actionCreator The action to expose.
   * @example
   * context.exposeAction("addPost", createAction<Post>("addPost"));
   *
   * export const { addPost } = slice.actions
   *
   * dispatch(addPost(post))
   */
  exposeAction(
    name: string,
    // TODO: see if there's a way to get the actual type cleanly
    actionCreator: unknown
  ): ReducerHandlingContextMethods<State>
  /**
   * Add a case reducer to be exposed under the final `slice.caseReducers` key.
   * @param name The key to be exposed as.
   * @param reducer The reducer to expose.
   * @example
   * context.exposeCaseReducer("addPost", (state, action: PayloadAction<Post>) => {
   *   state.push(action.payload)
   * })
   *
   * slice.caseReducers.addPost([], addPost(post))
   */
  exposeCaseReducer(
    name: string,
    // TODO: see if there's a way to get the actual type cleanly
    reducer: unknown
  ): ReducerHandlingContextMethods<State>
  /**
   * Provides access to the initial state value given to the slice.
   * If a lazy state initializer was provided, it will be called and a fresh value returned.
   */
  getInitialState(): State
}

interface ReducerDetails {
  /** The key the reducer was defined under */
  reducerName: string
  /** The predefined action type, i.e. `${slice.name}/${reducerName}` */
  type: string
}

export type ReducerDefinitionsForType<Type extends RegisteredReducerType> = {
  [T in keyof SliceReducerCreators]-?:
    | Extract<
        ReturnType<SliceReducerCreators[Type]['create']>,
        ReducerDefinition<Type>
      >
    | {
        [K in keyof ReturnType<SliceReducerCreators[T]['create']>]-?: Extract<
          ReturnType<SliceReducerCreators[T]['create']>[K],
          ReducerDefinition<Type>
        >
      }[keyof ReturnType<SliceReducerCreators[T]['create']>]
}[keyof SliceReducerCreators]

export type ReducerCreator<Type extends RegisteredReducerType> = {
  type: Type
  define: SliceReducerCreators[Type]['create']
} & (ReducerDefinitionsForType<Type> extends never
  ? {}
  : {
      handle<State>(
        details: ReducerDetails,
        definition: ReducerDefinitionsForType<Type>,
        context: ReducerHandlingContextMethods<State>
      ): void
    })

interface InjectIntoConfig<NewReducerPath extends string> extends InjectConfig {
  reducerPath?: NewReducerPath
}

/**
 * The return value of `createSlice`
 *
 * @public
 */
export interface Slice<
  State = any,
  CaseReducers extends SliceCaseReducers<State> = SliceCaseReducers<State>,
  Name extends string = string,
  ReducerPath extends string = Name,
  Selectors extends SliceSelectors<State> = SliceSelectors<State>
> {
  /**
   * The slice name.
   */
  name: Name

  /**
   *  The slice reducer path.
   */
  reducerPath: ReducerPath

  /**
   * The slice's reducer.
   */
  reducer: Reducer<State>

  /**
   * Action creators for the types of actions that are handled by the slice
   * reducer.
   */
  actions: CaseReducerActions<CaseReducers, Name>

  /**
   * The individual case reducer functions that were passed in the `reducers` parameter.
   * This enables reuse and testing if they were defined inline when calling `createSlice`.
   */
  caseReducers: SliceDefinedCaseReducers<CaseReducers>

  /**
   * Provides access to the initial state value given to the slice.
   * If a lazy state initializer was provided, it will be called and a fresh value returned.
   */
  getInitialState: () => State

  /**
   * Get localised slice selectors (expects to be called with *just* the slice's state as the first parameter)
   */
  getSelectors(this: this): Id<SliceDefinedSelectors<State, Selectors, State>>

  /**
   * Get globalised slice selectors (`selectState` callback is expected to receive first parameter and return slice state)
   */
  getSelectors<RootState>(
    this: this,
    selectState: (this: this, rootState: RootState) => State
  ): Id<SliceDefinedSelectors<State, Selectors, RootState>>

  /**
   * Selectors that assume the slice's state is `rootState[slice.reducerPath]` (which is usually the case)
   *
   * Equivalent to `slice.getSelectors((state: RootState) => state[slice.reducerPath])`.
   */
  selectors: Id<
    SliceDefinedSelectors<State, Selectors, { [K in ReducerPath]: State }>
  >

  /**
   * Inject slice into provided reducer (return value from `combineSlices`), and return injected slice.
   */
  injectInto<NewReducerPath extends string = ReducerPath>(
    this: this,
    injectable: {
      inject: (
        slice: { reducerPath: string; reducer: Reducer },
        config?: InjectConfig
      ) => void
    },
    config?: InjectIntoConfig<NewReducerPath>
  ): InjectedSlice<State, CaseReducers, Name, NewReducerPath, Selectors>

  /**
   * Select the slice state, using the slice's current reducerPath.
   *
   * Will throw an error if slice is not found.
   */
  selectSlice(this: this, state: { [K in ReducerPath]: State }): State
}

/**
 * A slice after being called with `injectInto(reducer)`.
 *
 * Selectors can now be called with an `undefined` value, in which case they use the slice's initial state.
 */
interface InjectedSlice<
  State = any,
  CaseReducers extends SliceCaseReducers<State> = SliceCaseReducers<State>,
  Name extends string = string,
  ReducerPath extends string = Name,
  Selectors extends SliceSelectors<State> = SliceSelectors<State>
> extends Omit<
    Slice<State, CaseReducers, Name, ReducerPath, Selectors>,
    'getSelectors' | 'selectors'
  > {
  /**
   * Get localised slice selectors (expects to be called with *just* the slice's state as the first parameter)
   */
  getSelectors(): Id<SliceDefinedSelectors<State, Selectors, State | undefined>>

  /**
   * Get globalised slice selectors (`selectState` callback is expected to receive first parameter and return slice state)
   */
  getSelectors<RootState>(
    selectState: (this: this, rootState: RootState) => State | undefined
  ): Id<SliceDefinedSelectors<State, Selectors, RootState>>

  /**
   * Selectors that assume the slice's state is `rootState[slice.name]` (which is usually the case)
   *
   * Equivalent to `slice.getSelectors((state: RootState) => state[slice.name])`.
   */
  selectors: Id<
    SliceDefinedSelectors<
      State,
      Selectors,
      { [K in ReducerPath]?: State | undefined }
    >
  >

  /**
   * Select the slice state, using the slice's current reducerPath.
   *
   * Returns initial state if slice is not found.
   */
  selectSlice(state: { [K in ReducerPath]?: State | undefined }): State
}

/**
 * Options for `createSlice()`.
 *
 * @public
 */
export interface CreateSliceOptions<
  State = any,
  CR extends SliceCaseReducers<State> = SliceCaseReducers<State>,
  Name extends string = string,
  ReducerPath extends string = Name,
  Selectors extends SliceSelectors<State> = SliceSelectors<State>,
  CreatorMap extends Record<string, RegisteredReducerType> = {}
> {
  /**
   * The slice's name. Used to namespace the generated action types.
   */
  name: Name

  /**
   * The slice's reducer path. Used when injecting into a combined slice reducer.
   */
  reducerPath?: ReducerPath

  /**
   * The initial state that should be used when the reducer is called the first time. This may also be a "lazy initializer" function, which should return an initial state value when called. This will be used whenever the reducer is called with `undefined` as its state value, and is primarily useful for cases like reading initial state from `localStorage`.
   */
  initialState: State | (() => State)

  /**
   * A mapping from action types to action-type-specific *case reducer*
   * functions. For every action type, a matching action creator will be
   * generated using `createAction()`.
   */
  reducers:
    | ValidateSliceCaseReducers<State, CR>
    | ((creators: ReducerCreators<State, CreatorMap>) => CR)

  /**
   * A callback that receives a *builder* object to define
   * case reducers via calls to `builder.addCase(actionCreatorOrType, reducer)`.
   *
   *
   * @example
```ts
import { createAction, createSlice, Action } from '@reduxjs/toolkit'
const incrementBy = createAction<number>('incrementBy')
const decrement = createAction('decrement')

interface RejectedAction extends Action {
  error: Error
}

function isRejectedAction(action: Action): action is RejectedAction {
  return action.type.endsWith('rejected')
}

createSlice({
  name: 'counter',
  initialState: 0,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(incrementBy, (state, action) => {
        // action is inferred correctly here if using TS
      })
      // You can chain calls, or have separate `builder.addCase()` lines each time
      .addCase(decrement, (state, action) => {})
      // You can match a range of action types
      .addMatcher(
        isRejectedAction,
        // `action` will be inferred as a RejectedAction due to isRejectedAction being defined as a type guard
        (state, action) => {}
      )
      // and provide a default case if no other handlers matched
      .addDefaultCase((state, action) => {})
    }
})
```
   */
  extraReducers?: (builder: ActionReducerMapBuilder<State>) => void

  /**
   * A map of selectors that receive the slice's state and any additional arguments, and return a result.
   */
  selectors?: Selectors
}

export interface CaseReducerDefinition<
  S = any,
  A extends Action = UnknownAction
> extends CaseReducer<S, A>,
    ReducerDefinition<ReducerType.reducer> {}

/**
 * A CaseReducer with a `prepare` method.
 *
 * @public
 */
export type CaseReducerWithPrepare<State, Action extends PayloadAction> = {
  reducer: CaseReducer<State, Action>
  prepare: PrepareAction<Action['payload']>
}

export interface CaseReducerWithPrepareDefinition<
  State,
  Action extends PayloadAction
> extends CaseReducerWithPrepare<State, Action>,
    ReducerDefinition<ReducerType.reducerWithPrepare> {}

export interface PreparedCaseReducerDefinition<
  State,
  Prepare extends PrepareAction<any>
> extends ReducerDefinition<ReducerType.reducerWithPrepare> {
  prepare: Prepare
  reducer: CaseReducer<
    State,
    ReturnType<_ActionCreatorWithPreparedPayload<Prepare>>
  >
}

export interface AsyncThunkSliceReducerConfig<
  State,
  ThunkArg extends any,
  Returned = unknown,
  ThunkApiConfig extends AsyncThunkConfig = {}
> {
  pending?: CaseReducer<
    State,
    ReturnType<AsyncThunk<Returned, ThunkArg, ThunkApiConfig>['pending']>
  >
  rejected?: CaseReducer<
    State,
    ReturnType<AsyncThunk<Returned, ThunkArg, ThunkApiConfig>['rejected']>
  >
  fulfilled?: CaseReducer<
    State,
    ReturnType<AsyncThunk<Returned, ThunkArg, ThunkApiConfig>['fulfilled']>
  >
  settled?: CaseReducer<
    State,
    ReturnType<
      AsyncThunk<Returned, ThunkArg, ThunkApiConfig>['rejected' | 'fulfilled']
    >
  >
  options?: AsyncThunkOptions<ThunkArg, ThunkApiConfig>
}

export interface AsyncThunkSliceReducerDefinition<
  State,
  ThunkArg extends any,
  Returned = unknown,
  ThunkApiConfig extends AsyncThunkConfig = {}
> extends AsyncThunkSliceReducerConfig<
      State,
      ThunkArg,
      Returned,
      ThunkApiConfig
    >,
    ReducerDefinition<ReducerType.asyncThunk> {
  payloadCreator: AsyncThunkPayloadCreator<Returned, ThunkArg, ThunkApiConfig>
}

/**
 * Providing these as part of the config would cause circular types, so we disallow passing them
 */
type PreventCircular<ThunkApiConfig> = {
  [K in keyof ThunkApiConfig]: K extends 'state' | 'dispatch'
    ? never
    : ThunkApiConfig[K]
}

interface AsyncThunkCreator<
  State,
  CurriedThunkApiConfig extends PreventCircular<AsyncThunkConfig> = PreventCircular<AsyncThunkConfig>
> {
  <ThunkArg extends any, Returned = unknown>(
    payloadCreator: AsyncThunkPayloadCreator<
      Returned,
      ThunkArg,
      CurriedThunkApiConfig
    >,
    config?: AsyncThunkSliceReducerConfig<
      State,
      ThunkArg,
      Returned,
      CurriedThunkApiConfig
    >
  ): AsyncThunkSliceReducerDefinition<
    State,
    ThunkArg,
    Returned,
    CurriedThunkApiConfig
  >
  <
    ThunkArg extends any,
    Returned = unknown,
    ThunkApiConfig extends PreventCircular<AsyncThunkConfig> = {}
  >(
    payloadCreator: AsyncThunkPayloadCreator<
      Returned,
      ThunkArg,
      ThunkApiConfig
    >,
    config?: AsyncThunkSliceReducerConfig<
      State,
      ThunkArg,
      Returned,
      ThunkApiConfig
    >
  ): AsyncThunkSliceReducerDefinition<State, ThunkArg, Returned, ThunkApiConfig>
  withTypes<
    ThunkApiConfig extends PreventCircular<AsyncThunkConfig>
  >(): AsyncThunkCreator<
    State,
    OverrideThunkApiConfigs<CurriedThunkApiConfig, ThunkApiConfig>
  >
}

/**
 * The type describing a slice's `reducers` option.
 *
 * @public
 */
export type SliceCaseReducers<State> =
  | Record<string, ReducerDefinition>
  | Record<
      string,
      | CaseReducer<State, PayloadAction<any>>
      | CaseReducerWithPrepare<State, PayloadAction<any, string, any, any>>
    >

/**
 * The type describing a slice's `selectors` option.
 */
export type SliceSelectors<State> = {
  [K: string]: (sliceState: State, ...args: any[]) => any
}

export type SliceActionType<
  SliceName extends string,
  ActionName extends keyof any
> = ActionName extends string | number ? `${SliceName}/${ActionName}` : string

/**
 * Derives the slice's `actions` property from the `reducers` options
 *
 * @public
 */
export type CaseReducerActions<
  CaseReducers extends SliceCaseReducers<any>,
  SliceName extends string
> = Id<
  UnionToIntersection<
    SliceReducerCreators<
      any,
      CaseReducers,
      SliceName
    >[RegisteredReducerType]['actions']
  >
>

/**
 * Get a `PayloadActionCreator` type for a passed `CaseReducerWithPrepare`
 *
 * @internal
 */
type ActionCreatorForCaseReducerWithPrepare<
  CR extends { prepare: any },
  Type extends string
> = _ActionCreatorWithPreparedPayload<CR['prepare'], Type>

/**
 * Get a `PayloadActionCreator` type for a passed `CaseReducer`
 *
 * @internal
 */
type ActionCreatorForCaseReducer<CR, Type extends string> = CR extends (
  state: any,
  action: infer Action
) => any
  ? Action extends { payload: infer P }
    ? PayloadActionCreator<P, Type>
    : ActionCreatorWithoutPayload<Type>
  : ActionCreatorWithoutPayload<Type>

/**
 * Extracts the CaseReducers out of a `reducers` object, even if they are
 * tested into a `CaseReducerWithPrepare`.
 *
 * @internal
 */
type SliceDefinedCaseReducers<CaseReducers extends SliceCaseReducers<any>> = Id<
  UnionToIntersection<
    SliceReducerCreators<
      any,
      CaseReducers,
      any
    >[RegisteredReducerType]['caseReducers']
  >
>

type RemappedSelector<S extends Selector, NewState> = S extends Selector<
  any,
  infer R,
  infer P
>
  ? Selector<NewState, R, P> & { unwrapped: S }
  : never

/**
 * Extracts the final selector type from the `selectors` object.
 *
 * Removes the `string` index signature from the default value.
 */
type SliceDefinedSelectors<
  State,
  Selectors extends SliceSelectors<State>,
  RootState
> = {
  [K in keyof Selectors as string extends K ? never : K]: RemappedSelector<
    Selectors[K],
    RootState
  >
}

/**
 * Used on a SliceCaseReducers object.
 * Ensures that if a CaseReducer is a `CaseReducerWithPrepare`, that
 * the `reducer` and the `prepare` function use the same type of `payload`.
 *
 * Might do additional such checks in the future.
 *
 * This type is only ever useful if you want to write your own wrapper around
 * `createSlice`. Please don't use it otherwise!
 *
 * @public
 */
export type ValidateSliceCaseReducers<
  S,
  ACR extends SliceCaseReducers<S>
> = ACR &
  {
    [T in keyof ACR]: ACR[T] extends {
      reducer(s: S, action?: infer A): any
    }
      ? {
          prepare(...a: never[]): Omit<A, 'type'>
        }
      : {}
  }

function getType(slice: string, actionKey: string): string {
  return `${slice}/${actionKey}`
}

export const reducerCreator: ReducerCreator<ReducerType.reducer> = {
  type: ReducerType.reducer,
  define(caseReducer: CaseReducer<any, any>) {
    return Object.assign(
      {
        // hack so the wrapping function has the same name as the original
        // we need to create a wrapper so the `reducerDefinitionType` is not assigned to the original
        [caseReducer.name](...args: Parameters<typeof caseReducer>) {
          return caseReducer(...args)
        },
      }[caseReducer.name],
      {
        _reducerDefinitionType: ReducerType.reducer,
      } as const
    )
  },
  handle(
    { type, reducerName },
    reducer: CaseReducer<any, PayloadAction<any>>,
    context
  ) {
    context
      .addCase(type, reducer)
      .exposeCaseReducer(reducerName, reducer)
      .exposeAction(reducerName, createAction(type))
  },
}

export const preparedReducerCreator: ReducerCreator<ReducerType.reducerWithPrepare> =
  {
    type: ReducerType.reducerWithPrepare,
    define(prepare, reducer) {
      return {
        _reducerDefinitionType: ReducerType.reducerWithPrepare,
        prepare,
        reducer,
      }
    },
    handle({ type, reducerName }, { prepare, reducer }, context) {
      context
        .addCase(type, reducer)
        .exposeCaseReducer(reducerName, reducer)
        .exposeAction(reducerName, createAction(type, prepare))
    },
  }

export const asyncThunkCreator: ReducerCreator<ReducerType.asyncThunk> = {
  type: ReducerType.asyncThunk,
  define: /* @__PURE__ */ (() => {
    function asyncThunk(
      payloadCreator: AsyncThunkPayloadCreator<any, any>,
      config: AsyncThunkSliceReducerConfig<any, any>
    ): AsyncThunkSliceReducerDefinition<any, any> {
      return {
        _reducerDefinitionType: ReducerType.asyncThunk,
        payloadCreator,
        ...config,
      }
    }
    asyncThunk.withTypes = () => asyncThunk
    return asyncThunk as AsyncThunkCreator<any>
  })(),
  handle({ type, reducerName }, definition, context) {
    const { payloadCreator, fulfilled, pending, rejected, settled, options } =
      definition
    const thunk = createAsyncThunk(type, payloadCreator, options as any)
    context.exposeAction(reducerName, thunk)

    if (fulfilled) {
      context.addCase(thunk.fulfilled, fulfilled)
    }
    if (pending) {
      context.addCase(thunk.pending, pending)
    }
    if (rejected) {
      context.addCase(thunk.rejected, rejected)
    }
    if (settled) {
      context.addMatcher(thunk.settled, settled)
    }

    context.exposeCaseReducer(reducerName, {
      fulfilled: fulfilled || noop,
      pending: pending || noop,
      rejected: rejected || noop,
      settled: settled || noop,
    })
  },
}

function noop() {}

interface BuildCreateSliceConfig<
  CreatorMap extends Record<string, RegisteredReducerType>
> {
  creators?: {
    [Name in keyof CreatorMap]: Name extends 'reducer' | 'preparedReducer'
      ? never
      : ReducerCreator<CreatorMap[Name]>
  } & { asyncThunk?: ReducerCreator<ReducerType.asyncThunk> }
}

export function buildCreateSlice<
  CreatorMap extends Record<string, RegisteredReducerType> = {}
>(buildCreateSliceConfig: BuildCreateSliceConfig<CreatorMap> = {}) {
  const { creators: creatorMap = {} } = buildCreateSliceConfig

  const creators: Record<
    string,
    ReducerCreator<RegisteredReducerType>['define']
  > = {
    reducer: reducerCreator.define,
    preparedReducer: preparedReducerCreator.define,
  }
  const handlers: Partial<
    Record<
      RegisteredReducerType,
      ReducerCreator<RegisteredReducerType>['handle']
    >
  > = {
    [ReducerType.reducer]: reducerCreator.handle,
    [ReducerType.reducerWithPrepare]: preparedReducerCreator.handle,
  }

  for (const [name, creator] of Object.entries<
    ReducerCreator<RegisteredReducerType>
  >(creatorMap)) {
    if (name === 'reducer' || name === 'preparedReducer') {
      throw new Error('Cannot use reserved creator name: ' + name)
    }
    if (
      creator.type === ReducerType.reducer ||
      creator.type === ReducerType.reducerWithPrepare
    ) {
      throw new Error('Cannot use reserved creator type: ' + creator.type)
    }
    creators[name] = creator.define
    handlers[creator.type] = creator.handle
  }
  return function createSlice<
    State,
    CaseReducers extends SliceCaseReducers<State>,
    Name extends string,
    Selectors extends SliceSelectors<State>,
    ReducerPath extends string = Name
  >(
    options: CreateSliceOptions<
      State,
      CaseReducers,
      Name,
      ReducerPath,
      Selectors,
      CreatorMap
    >
  ): Slice<State, CaseReducers, Name, ReducerPath, Selectors> {
    const { name, reducerPath = name as unknown as ReducerPath } = options
    if (!name) {
      throw new Error('`name` is a required option for createSlice')
    }

    if (
      typeof process !== 'undefined' &&
      process.env.NODE_ENV === 'development'
    ) {
      if (options.initialState === undefined) {
        console.error(
          'You must provide an `initialState` value that is not `undefined`. You may have misspelled `initialState`'
        )
      }
    }

    const getInitialState = makeGetInitialState(options.initialState)

    const context: ReducerHandlingContext<State> = {
      sliceCaseReducersByName: {},
      sliceCaseReducersByType: {},
      actionCreators: {},
      sliceMatchers: [],
    }

    const contextMethods: ReducerHandlingContextMethods<State> = {
      addCase(
        typeOrActionCreator: string | TypedActionCreator<any>,
        reducer: CaseReducer<State>
      ) {
        const type =
          typeof typeOrActionCreator === 'string'
            ? typeOrActionCreator
            : typeOrActionCreator.type
        if (!type) {
          throw new Error(
            '`context.addCase` cannot be called with an empty action type'
          )
        }
        if (type in context.sliceCaseReducersByType) {
          throw new Error(
            '`context.addCase` cannot be called with two reducers for the same action type: ' +
              type
          )
        }
        context.sliceCaseReducersByType[type] = reducer
        return contextMethods
      },
      addMatcher(matcher, reducer) {
        context.sliceMatchers.push({ matcher, reducer })
        return contextMethods
      },
      exposeAction(name, actionCreator) {
        context.actionCreators[name] = actionCreator
        return contextMethods
      },
      exposeCaseReducer(name, reducer) {
        context.sliceCaseReducersByName[name] = reducer
        return contextMethods
      },
      getInitialState,
    }

    if (typeof options.reducers === 'function') {
      const reducers = options.reducers(creators as any)
      for (const [reducerName, reducerDefinition] of Object.entries(reducers)) {
        const { _reducerDefinitionType: type } = reducerDefinition
        if (typeof type === 'undefined') {
          throw new Error(
            'Please use reducer creators passed to callback. Each reducer definition must have a `_reducerDefinitionType` property indicating which handler to use.'
          )
        }
        const handler = handlers[type as RegisteredReducerType]
        if (!handler) {
          throw new Error('Unsupported reducer type: ' + type)
        }
        const reducerDetails: ReducerDetails = {
          reducerName,
          type: getType(name, reducerName),
        }
        handler(reducerDetails, reducerDefinition, contextMethods)
      }
    } else {
      for (const [reducerName, reducerDefinition] of Object.entries(
        options.reducers
      )) {
        const reducerDetails: ReducerDetails = {
          reducerName,
          type: getType(name, reducerName),
        }
        if ('reducer' in reducerDefinition) {
          preparedReducerCreator.handle(
            reducerDetails,
            reducerDefinition,
            contextMethods
          )
        } else {
          reducerCreator.handle(
            reducerDetails,
            reducerDefinition,
            contextMethods
          )
        }
      }
    }

    function buildReducer() {
      if (process.env.NODE_ENV !== 'production') {
        if (typeof options.extraReducers === 'object') {
          throw new Error(
            "The object notation for `createSlice.extraReducers` has been removed. Please use the 'builder callback' notation instead: https://redux-toolkit.js.org/api/createSlice"
          )
        }
      }
      const [
        extraReducers = {},
        actionMatchers = [],
        defaultCaseReducer = undefined,
      ] =
        typeof options.extraReducers === 'function'
          ? executeReducerBuilderCallback(options.extraReducers)
          : [options.extraReducers]

      const finalCaseReducers = {
        ...extraReducers,
        ...context.sliceCaseReducersByType,
      }

      return createReducer(options.initialState, (builder) => {
        for (let key in finalCaseReducers) {
          builder.addCase(key, finalCaseReducers[key] as CaseReducer)
        }
        for (let sM of context.sliceMatchers) {
          builder.addMatcher(sM.matcher, sM.reducer)
        }
        for (let m of actionMatchers) {
          builder.addMatcher(m.matcher, m.reducer)
        }
        if (defaultCaseReducer) {
          builder.addDefaultCase(defaultCaseReducer)
        }
      })
    }

    const selectSelf = (state: State) => state

    const injectedSelectorCache = new WeakMap<
      Slice<State, CaseReducers, Name, ReducerPath, Selectors>,
      WeakMap<
        (rootState: any) => State | undefined,
        Record<string, (rootState: any) => any>
      >
    >()

    let _reducer: ReducerWithInitialState<State>

    const slice: Slice<State, CaseReducers, Name, ReducerPath, Selectors> = {
      name,
      reducerPath,
      reducer(state, action) {
        if (!_reducer) _reducer = buildReducer()

        return _reducer(state, action)
      },
      actions: context.actionCreators as any,
      caseReducers: context.sliceCaseReducersByName as any,
      getInitialState,
      getSelectors(selectState: (rootState: any) => State = selectSelf) {
        const selectorCache = emplace(injectedSelectorCache, this, {
          insert: () => new WeakMap(),
        })

        return emplace(selectorCache, selectState, {
          insert: () => {
            const map: Record<string, Selector<any, any>> = {}
            for (const [name, selector] of Object.entries(
              options.selectors ?? {}
            )) {
              map[name] = wrapSelector(
                this,
                selector,
                selectState,
                this !== slice
              )
            }
            return map
          },
        }) as any
      },
      selectSlice(state) {
        let sliceState = state[this.reducerPath]
        if (typeof sliceState === 'undefined') {
          // check if injectInto has been called
          if (this !== slice) {
            sliceState = this.getInitialState()
          } else if (process.env.NODE_ENV !== 'production') {
            throw new Error(
              'selectSlice returned undefined for an uninjected slice reducer'
            )
          }
        }
        return sliceState
      },
      get selectors() {
        return this.getSelectors(this.selectSlice)
      },
      injectInto(injectable, { reducerPath: pathOpt, ...config } = {}) {
        const reducerPath = pathOpt ?? this.reducerPath
        injectable.inject({ reducerPath, reducer: this.reducer }, config)
        return {
          ...this,
          reducerPath,
        } as any
      },
    }
    return slice
  }
}

function wrapSelector<State, NewState, S extends Selector<State>>(
  slice: Slice<State, any>,
  selector: S,
  selectState: Selector<NewState, State>,
  injected?: boolean
) {
  function wrapper(rootState: NewState, ...args: any[]) {
    let sliceState = selectState.call(slice, rootState)
    if (typeof sliceState === 'undefined') {
      if (injected) {
        sliceState = slice.getInitialState()
      } else if (process.env.NODE_ENV !== 'production') {
        throw new Error(
          'selectState returned undefined for an uninjected slice reducer'
        )
      }
    }
    return selector(sliceState, ...args)
  }
  wrapper.unwrapped = selector
  return wrapper as RemappedSelector<S, NewState>
}

/**
 * A function that accepts an initial state, an object full of reducer
 * functions, and a "slice name", and automatically generates
 * action creators and action types that correspond to the
 * reducers and state.
 *
 * @public
 */
export const createSlice = buildCreateSlice()
