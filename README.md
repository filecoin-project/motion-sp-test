# motion-sp-test

A simple production test suite for [Motion](https://github.com/filecoin-project/motion). Make deals using a fixed corpus of data, then test and record the data onboarding process.

Intended to be used on an EC2 instance that has an IAM role that lets it access the data corpus on S3. Alternatively AWS credentials can be provided in the config file or in a credentials.json file.

Status data is written to status.json, which is updated as the test progresses. The test is able to be resumed and should work out where it was up to by using this file.

status.json can be used to determine timings for the various stages of the test; including data onboarding time, replica status progress and timing for each change, and details about the replicas themselves. It also includes a sha2-256 digest of each onboarded file, which can be used to test retrievals through Motion to ensure the data is intact.

```
npm install
npm start
# or just ./sptest.js
```

## Retrieval testing

Running `./retrieve.js` will perform retrievals against the Motion instance configured in config.json against the stored files recorded in the status file (status.json by default). It will retrieve files in random order, and will only retrieve files that have been successfully onboarded. The retrieved files are checked against the stored sha2-256 digest to ensure they are intact. Speed, TTFB and TTLB are recorded and the averages are printed.

```
Usage: retrieve.js [options]
Options:
    --min <size>              Minimum file size to consider (optional, default 0)
    --max <size>              Maximum file size to consider (optional, default Infinity)
    --duration <time>         Duration to run for (optional, default 5m)
    --state any|local|remote  Only consider files with this state (optional, default any)
```

### Example

```
./retrieve.js --min 50MiB --max 100MiB --duration 30s --state local
Testing retrieval using random selection from 99 local files between 52.43 MB and 104.86 MB for 30 seconds
Fetching ..........................
Files fetched: 26
Average size:  69.47 MB
Average speed: 58.80 MB / s
Average TTFB:  4.55367 ms
Average TTLB:  1184.647486 ms
```
