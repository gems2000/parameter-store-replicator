const AWS = require('aws-sdk')

const sourceSSM = new AWS.SSM({
  region: process.env.AWS_DEFAULT_REGION
})
const targetSSM = new AWS.SSM({
  region: process.env.AWS_TARGET_REGION
})

const checkTarget = async (event) => {
  try {
    // check if target exists already
    return await targetSSM.getParameter({
      Name: event.detail.name,
      WithDecryption: true
    }).promise()
  } catch (error) {
    // we will consider a ParameterNotFound response from the target a non error
    if (error.code !== 'ParameterNotFound') {
      return Promise.reject(error)
    }
    return Promise.resolve()
  }
}

const update = async (event) => {
  // get the source value
  const sourceParam = await sourceSSM.getParameter({
    Name: event.detail.name,
    WithDecryption: true
  }).promise()

  const targetParam = await checkTarget(event)
  if (!targetParam || targetParam.Parameter.Value !== sourceParam.Parameter.Value || targetParam.Parameter.Type !== sourceParam.Parameter.Type) {
    // remove unused Keys
    delete sourceParam.Parameter.Version
    delete sourceParam.Parameter.ARN
    delete sourceParam.Parameter.LastModifiedDate
    // enable overwrites
    sourceParam.Parameter.Overwrite = true
    return targetSSM.putParameter(sourceParam.Parameter).promise()
  } else {
    console.log(`Parameter ${event.detail.name} is already in ${process.env.AWS_TARGET_REGION} with the same value and type, ignoring`)
    return Promise.resolve()
  }
}

const remove = async (event) => {
  try {
    return targetSSM.deleteParameter({
      Name: event.detail.name
    }).promise()
  } catch (error) {
    if (error.code === 'ParameterNotFound') {
      console.log(`Parameter ${event.detail.name} was not found in ${process.env.AWS_TARGET_REGION}, ignoring`)
      return Promise.resolve()
    }
    return Promise.reject(error)
  }
}

const operations = {
  Create: update,
  Update: update,
  Delete: remove
}

exports.replicate = async (event, context, callback) => {
  console.log(JSON.stringify(event))
  try {
    if (event.detail.operation in operations) {
      if (event.detail.name.includes('/prod/')) {
        const success = await operations[event.detail.operation](event)
        if (success) {
          console.log(`${event.detail.operation} result:\n${JSON.stringify(success)}`)
        }
      } else {
        console.log(`Unknown operation "${event.detail.operation}":\n ${JSON.stringify(event)}`)
      }
    } else {
      console.log('Only Production Resources are allowed for Replication')
    }
  } catch (error) {
    console.log(`Operation failed for\n ${JSON.stringify(event)}\n${JSON.stringify(error)}`)
    if (error.retryable) {
      return callback(error)
    }
  }
  return callback(null, 'OK')
}