import diff from 'virtual-dom/diff'
import parser from 'vdom-parser'
import patch from 'virtual-dom/patch'

const vDomState = {
  rootNode: undefined,
  vDomTree: undefined
}

const mountPage = (newVDomTree) => {
  vDomState.rootNode = patch(vDomState.rootNode, diff(vDomState.vDomTree, newVDomTree))
  vDomState.vDomTree = newVDomTree
}

export default dependencies => async ({
  providers = [],
  renderPage,
  rootNode,
  slots
}) => {
  const actionResults = { ...dependencies.store, errors: {} }
  const allCommands = {
    ...dependencies.commands,
    cancelError: ({ errorName }) => {
      if (actionResults.errors[errorName]) {
        actionResults.errors[errorName].isCancelled = true

        if (actionResults.errors[errorName].due) {
          actionResults.errors[errorName].due.forEach((error) => {
            error.isCancelled = true
          })
        }
      }
    },
    redirect (path) {
      global.window.location = `${global.window.location.origin}/${path}`
    },
    reload: async () => {
      await runProviders()
      mountPage(renderPage({ actionResults, getSlot: createSlotRenderer() }))
    }
  }
  const createSlotRenderer = (commandBeingExecuted = null) => ({ id }) => {
    if (slots[id]) {
      return hostData => slots[id]({
        actionResults,
        actions: boundCommands,
        commandBeingExecuted,
        hostData
      })
    }

    return () => null
  }
  const handleError = (error) => {
    if (!actionResults.errors[error.name]) {
      actionResults.errors[error.name] = error
    } else {
      Object.getOwnPropertyNames(error)
        .reduce((acc, propName) => Object.assign(acc, { [propName]: error[propName] }), actionResults.errors[error.name])

      actionResults.errors[error.name].isCancelled = false
    }

    actionResults.errors[error.name].throwCount = actionResults.errors[error.name].throwCount || 0
    actionResults.errors[error.name].throwCount += 1

    if (error.due) {
      Object.assign(
        actionResults.errors,
        error.due.reduce((acc, error) => ({ ...acc, [error.name]: error }), {})
      )
    }

    mountPage(renderPage({ actionResults, getSlot: createSlotRenderer() }))
  }
  const boundCommands = Object.keys(allCommands).reduce((acc, commandName) => ({
    ...acc,
    [commandName]: (...args) => {
      try {
        const commandBeingExecuted = allCommands[commandName](...args)

        if (commandBeingExecuted instanceof Promise) {
          mountPage(renderPage({ actionResults, getSlot: createSlotRenderer(commandName) }))
          return commandBeingExecuted
            .then((result) => {
              actionResults[commandName] = result
              mountPage(renderPage({ actionResults, getSlot: createSlotRenderer() }))
            })
            .catch(handleError)
        }
        actionResults[commandName] = commandBeingExecuted
        mountPage(renderPage({ actionResults, getSlot: createSlotRenderer() }))
        return actionResults[commandName]
      } catch (err) {
        handleError(err)
      }
    }
  }), allCommands)
  const incomingDataProvided = (providerName, data) => {
    actionResults[providerName] = data
    mountPage(renderPage({ actionResults, getSlot: createSlotRenderer() }))
  }

  const runProviders = async () => {
    for (const providerName of providers) {
      const providerBeingExecuted = dependencies.providers[providerName](actionResults)

      if (providerBeingExecuted instanceof Promise) {
        actionResults[providerName] = await providerBeingExecuted
      } else if (typeof providerBeingExecuted === 'function') {
        providerBeingExecuted(data => incomingDataProvided(providerName, data))
      } else {
        actionResults[providerName] = providerBeingExecuted
      }
    }
  }

  actionResults.fail = handleError
  actionResults.route = global.window.location
  actionResults.parseRootNodeDataset = { ...rootNode.dataset }
  vDomState.rootNode = rootNode
  vDomState.vDomTree = parser(rootNode)
  await runProviders()
  mountPage(renderPage({ actionResults, getSlot: createSlotRenderer() }))

  if (typeof dependencies.afterProviders === 'function') {
    dependencies.afterProviders()
  }
}
