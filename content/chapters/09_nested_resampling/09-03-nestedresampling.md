---
title: "Chapter 09.03: Nested Resampling"
weight: 9003
quizdown: true
---
In this section, we will explain why and how nested resampling is done.

<!--more-->

### Lecture video

{{< video id="-d338rc076s" >}}

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/slides-pdf/slides-nested-nestedresampling.pdf" >}}

### Code demo

**Kaggle Challenge**

You can run the code snippets in the demos on your local machine. The corresponding Rmd version of this demo can be found [here](https://github.com/compstat-lmu/lecture_i2ml/blob/master/code-demos/code_demo_kaggle.Rmd). If you want to render the Rmd files to PDF, you need the accompanying [style files](https://github.com/compstat-lmu/lecture_i2ml/tree/master/style). 

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/code-demos-pdf/code_demo_kaggle.pdf" >}}


### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] How well tuning works depends on the learner and the impact of the hyperparameters on that learner.
- [ ] Grid search often works better than random search.
- [x] Grid search scales exponentially with the dimension of the parameter space.
- [x] Grid search evaluates many points from the parameter space that aren't of interest.
- [x] Random search works often better due to its better exploration of the hyperparameter space.
- [ ] Random search scales very well with the dimension of the hyperparameter space. 
- [ ] Random search as well as grid search has the problem of discretization.

{{< /quizdown >}}