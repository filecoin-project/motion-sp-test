# motion-sp-test

A simple production test suite for [Motion](https://github.com/filecoin-project/motion). Make deals using a fixed corpus of data, then test and record the data onboarding process.

Intended to be used on an EC2 instance that has an IAM role that lets it access the data corpus on S3. Alternatively AWS credentials can be provided in the config file or in a credentials.json file.

Status data is written to status.json, which is updated as the test progresses. The test is able to be resumed and should work out where it was up to by using this file.

status.json can be used to determine timings for the various stages of the test; including data onboarding time, replica status progress and timing for each change, and details about the replicas themselves. It also includes a sha2-256 digest of each onboarded file, which can be used to test retrievals through Motion to ensure the data is intact.

Currently does not feature retrieval functionality, this wil be added in future to test and benchmark fetching.

```
npm install
npm start
```