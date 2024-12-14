#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkEc2JenkinsCfnInstanceEbsStack } from '../lib/cdk-ec2-jenkins-cfninstance-ebs-stack';

const app = new cdk.App();
new CdkEc2JenkinsCfnInstanceEbsStack(app, 'CdkEc2JenkinsStack', {
  env: {
    account: '[YourAWSAccountID]', region: '[YourAWSRegion]'
  }
});